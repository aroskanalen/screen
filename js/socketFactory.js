ikApp.factory('socketFactory', ['$http', '$q', function($http, $q) {
  var factory = {};

  // Get the load configuration object.
  var config = window.config;

  // Communication with web-socket.
  var socket = undefined;

  // Global variable with token cookie.
  var token_cookie = undefined;

  /**
   * Cookie object.
   *
   * Used to handle the cookie(s), mainly used to store the connection JSON Web Token.
   */
  var Cookie = (function() {
    var Cookie = function(name) {
      var self = this;
      var name = name;

      // Get token.
      self.get = function get() {
        var regexp = new RegExp("(?:^" + name + "|;\s*"+ name + ")=(.*?)(?:;|$)", "g");
        var result = regexp.exec(document.cookie);
        return (result === null) ? undefined : result[1];
      }

      // Set token
      self.set = function set(value, expire) {
        var cookie = name + '=' + escape(value) + ';';

        if (expire == undefined) {
          expire = 'Thu, 01 Jan 2018 00:00:00 GMT';
        }
        cookie += 'expires=' + expire + ';';

        cookie += 'path=/;';
        cookie += 'domain=' + document.domain + ';';

        // Check if cookie should be available only over https.
        if (config.cookie.secure === true) {
          cookie += ' secure';
        }

        document.cookie = cookie;
      }

      // Remove the cookie by expiring it.
      self.remove = function remove() {
        self.set('', 'Thu, 01 Jan 1970 00:00:00 GMT');
      }
    }

    return Cookie;
  })();

  /***************************
   * Private methods
   *****************/

  /**
   * Activate the screen and connect.
   * @param activationCode
   *   Activation code for the screen.
   */
  var activateScreenAndConnect = function activateScreenAndConnect(activationCode) {
    // Build ajax post request.
    var request = new XMLHttpRequest();
    request.open('POST', config.resource.server + config.resource.uri + '/activate', true);
    request.setRequestHeader('Content-Type', 'application/json');

    request.onload = function(resp) {
      if (request.readyState == 4 && request.status == 200) {
        // Success.
        resp = JSON.parse(request.responseText);

        // Try to get connection to the proxy.
        connect(resp.token);
      }
      else {
        // We reached our target server, but it returned an error
        alert('Activation could not be performed.');
      }
    }

    request.onerror = function(exception) {
      // There was a connection error of some sort
      alert('Activation request failed.');
    }

    // Send the request.
    request.send(JSON.stringify({ activationCode: activationCode }));
  }

  /**
   * Get GET-parameter @name from the url
   * @param name
   * @returns {string}
   */
  var getParameterByName = function getParameterByName(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");

    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)");
    var results = regex.exec(location.search);

    return results == null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
  }

  /**
   * Check if a valid token exists.
   *
   * If a token is found a connection to the proxy is attempted. If token
   * not found the activation form is displayed.
   *
   * If the key url-parameter is set, use that for activation.
   */
  var activation = function activation() {
    // Check if token exists.
    token_cookie = new Cookie('infostander_token');
    var token = token_cookie.get('token');

    if (token === undefined) {
      // If key in url do ajax and return;
      var key = getParameterByName('key');
      if (key !== "") {
        activateScreenAndConnect(key);

        return false;
      }

      // Token not found, so display actiavte page.
      var template = Handlebars.templates.activation;
      var output = template({button: 'Activation'});

      // Insert the render content.
      var el = document.getElementsByClassName('content');
      el[0].innerHTML = output;

      // Add event listener to form submit button.
      el = document.getElementsByClassName('btn-activate');
      el[0].addEventListener('click', function(event) {
        event.preventDefault();

        // Send the request.
        var form = document.getElementsByClassName('form-activation-code');
        activateScreenAndConnect(form[0].value);

        return false;
      });
    }
    else {
      // If token exists, connect to the socket.
      connect(token);
    }
  }

  /**
   * Load the socket.io script from the proxy server.
   *
   * Retry if  io  is not loaded after 30 seconds.
   */
  var loadSocket = function loadSocket(callback) {
    var file = document.createElement('script');
    file.setAttribute('type', 'text/javascript');
    file.setAttribute('src', config.resource.server +  config.resource.uri + '/socket.io/socket.io.js');
    file.onload = function() {
      if (typeof io === "undefined") {
        if (window.console) {
          console.error("io not loaded");
        }
        document.getElementsByTagName("head")[0].removeChild(file);
        window.setTimeout(factory.start(), 100);
      } else {
        callback();
      }
    };
    document.getElementsByTagName("head")[0].appendChild(file);
  }

  /**
   * Connect to the web-socket.
   *
   * @param string token
   *   JWT authentication token from the activation request.
   */
  var connect = function connect(token) {
    // Get connected to the server.
    socket = io.connect(config.ws.server, { query: 'token=' + token });

    // Handle error events.
    socket.on('error', function (reason) {
      if (window.console) {
        console.log(reason);
      }
    });

    // Handle connected event.
    socket.on('connect', function () {
      // Connection accepted, so lets store the token.
      token_cookie.set(token);

      // Set ready state at the server, if not reconnected.
      if (content_init) {
        socket.emit('ready', { token: token });
      }
    });

    // Handled deletion of screen event.
    socket.on('booted', function (data) {
      // Remove cookie with token.
      token_cookie.remove();

      // Reload application.
      location.reload(true);
    });

    // Ready event - if the server accepted the ready command.
    socket.on('ready', function (data) {
      if (data.statusCode != 200) {
        // Screen not found will reload applicaton on dis-connection event.
        if (data.statusCode !== 404) {
          if (window.console) {
            console.log('Code: ' + data.statusCode + ' - Connection error');
          }
          return;
        }
      }
      else {
        // Remove the form.
        updateContent('Awaiting content...');
      }
    });

    // Pause event - if the server accepted the pause command.
    socket.on('pause', function (data) {
      if (data.statusCode != 200) {
        // @todo: error on pause command.
      }
    });

    // Reload - if the server accepted the pause command.
    socket.on('reload', function (data) {
      // Reload browser windows (by-pass-cache).
      location.reload(true);
    });

    // Channel pushed content.
    socket.on('channelPush', function (data) {
      if (window.console) {
        console.log("channelPush");
        console.log(data);
      }
    });
  };

  factory.start = function start() {
    loadSocket(function() {
      activation();
    });
  };

  return factory;
}]);