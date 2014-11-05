/**
 * @file
 * Contains the index controller.
 */

"use strict";

/**
 * Index Controller.
 * Controls the display of slides.
 */
ikApp.controller('IndexController', ['$scope', '$rootScope', '$timeout', 'socketFactory',
  function ($scope, $rootScope, $timeout, socketFactory) {
    $scope.step = 'init';
    $scope.slides = [
      [],
      []
    ];
    $scope.currentIndex = null;
    $scope.arrayIndex = 0;

    $scope.running = false;
    $scope.timeout = null;
    $scope.slidesUpdated = false;

    var fadeTime = 1000;

    // Used by progress bar
    $scope.progressBoxElements = 0;
    $scope.progressBoxElementsIndex = 0;

    /**
     * Returns true if the slide is scheduled to be shown now.
     *
     * @param slide
     * @returns {boolean}
     */
    var slideScheduled = function slideScheduled(slide) {
      var now = new Date().getTime() / 1000;
      return (!slide.schedule_from && !slide.schedule_to) ||
              (slide.schedule_from !== null && now >= slide.schedule_from && slide.schedule_to !== null && now < slide.schedule_to);
    };

    /**
     * Reset the progress bar.
     */
    var resetProgressBox = function resetProgressBox() {
      $scope.progressBoxElements = 0;
      $scope.progressBoxElementsIndex = 0;
      $scope.slides[$scope.arrayIndex].forEach(function(element) {
        if (slideScheduled(element)) {
          $scope.progressBoxElements++;
        }
      });
    };

    /**
     * Sets the progress bar style.
     *
     * @param duration
     */
    var startProgressBar = function startProgressBar(duration) {
      $scope.progressBarStyle = {
        "overflow": "hidden",
        "-webkit-transition": "width " + duration  + "s linear",
        "-moz-transition": "width " + duration + "s linear",
        "-o-transition": "width " + duration + "s linear",
        "transition": "width " + duration + "s linear",
        "width": "100%"
      };
    };

    /**
     * Resets the progress bar style.
     */
    var resetProgressBar = function resetProgressBar() {
      $scope.progressBarStyle = {
        "width": "0"
      };
    };

    /**
     * Set the next slide, and call displaySlide.
     */
    var nextSlide = function nextSlide() {
      $scope.currentIndex++;

      var otherArrayIndex = ($scope.arrayIndex + 1) % 2;

      if ($scope.currentIndex >= $scope.slides[$scope.arrayIndex].length) {
        if ($scope.slidesUpdated) {
          $scope.currentIndex = -1;
          $scope.arrayIndex = otherArrayIndex;
          $scope.slidesUpdated = false;
        }
        resetProgressBox();

        $scope.currentIndex = 0;
      }

      // If slides array is empty, wait 5 seconds, try again.
      if ($scope.slides[$scope.arrayIndex].length <= 0) {
        $timeout(nextSlide, 5000);
        return;
      }

      // Ignore if outside of schedule.
      if (!slideScheduled($scope.slides[$scope.arrayIndex][$scope.currentIndex])) {
        // Check if there are any slides scheduled.
        var scheduleEmpty = true;
        $scope.slides[$scope.arrayIndex].forEach(function(element) {
          if (slideScheduled(element)) {
            scheduleEmpty = false;
          }
        });

        if (!scheduleEmpty) {
          nextSlide();
        } else {
          // If no slide scheduled, go to end of array, wait 5 second, try again.
          $scope.currentIndex = $scope.slides[$scope.arrayIndex].length;
          $timeout(function() {
            nextSlide();
          }, 5000);
        }
      }
      else {
        displaySlide();
      }
    };

    /**
     * Display the current slide.
     * Call next slide.
     *
     * Include 2 seconds in timeout for fade in/outs.
     */
    var displaySlide = function() {
      $scope.progressBoxElementsIndex++;

      resetProgressBar();

      var slide = $scope.slides[$scope.arrayIndex][$scope.currentIndex];

      // Handle empty slides array.
      if (slide === undefined) {
        // Wait five seconds and try again.
        $timeout(function() {
          displaySlide();
        }, 5000);

        return;
      }

      // Handle video input or regular slide.
      if (slide.media_type === 'video') {
        if (slide.media.length <= 0) {
          nextSlide();
        }

        $timeout(function() {
          if (!slide.videojs) {
            slide.videojs = videojs('videoPlayer' + slide.uniqueId, {
              "controls": false,
              "autoplay": false,
              "preload": "none"
            });
          } else {
            slide.videojs.off('ended');
            slide.videojs.off('error');
            slide.videojs.off('play');
            slide.videojs.off('progress');
          }

          slide.videojs.load();

          // When the video is done, load next slide.
          slide.videojs.one('ended', function() {
            $scope.$apply(function() {
              nextSlide();
            });
          });

          slide.videojs.one('error', function() {
            $scope.$apply(function() {
              nextSlide();
            });
          });

          slide.videojs.on('progress', function(event) {
            if (slide.videojs.duration() > 0) {
              slide.videojs.off('progress');

              var dur = slide.videojs.duration();

              $scope.$apply(function() {
                // Set the progressbar animation.
                startProgressBar(dur);
              });
            }
          });

          slide.videojs.ready(function() {
            slide.videojs.play();
          });
        }, fadeTime);
      }
      else {
        // Set the progress bar animation.
        $timeout(function() {
          var dur = slide.duration;

          startProgressBar(dur);
        }, fadeTime);

        // Wait for slide duration, then show next slide.
        // + 2 seconds to account for fade in/outs.
        $scope.timeout = $timeout(function() {
          nextSlide();
        }, (slide.duration) * 1000 + fadeTime * 2);
      }
    };

    /**
     * Set the next slides to show.
     * @param data
     */
    var updateSlideShow = function updateSlideShow(data) {
      var otherArrayIndex = ($scope.arrayIndex + 1) % 2;

      $scope.slides[otherArrayIndex] = data.slides;
      $scope.slidesUpdated = true;
    };

    // Connect to the backend via sockets.
    socketFactory.start();

    // Connected to the backend and waiting for content.
    $rootScope.$on('awaitingContent', function() {
      $scope.$apply(function () {
        $scope.step = 'awaiting-content';
      });
    });

    // Content has arrived from the middleware.
    $rootScope.$on('showContent', function(event, data) {
      if (data === null) {
        return;
      }

      // The show is running simply update the slides.
      if ($scope.running) {
        updateSlideShow(data);
      }
      else {
        // The show was not running, so update the slides and start the show.
        $scope.$apply(function () {
          $scope.step = 'show-content';
          $scope.slides[0] = data.slides;

          // Reset progress box
          resetProgressBox();

          // Make sure the slides have been loaded. Then start the show.
          $timeout(function() {
            $scope.currentIndex = -1;

            $scope.running = true;
            nextSlide();
          }, 1000);
        });
      }
    });

    // Screen activation have failed.
    $rootScope.$on("activationNotComplete", function() {
      $scope.$apply(function () {
        $scope.step = 'not-activated';
      });
    });
  }
]);
