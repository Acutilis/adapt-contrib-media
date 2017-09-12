define([
    'core/js/adapt',
    'core/js/views/componentView',
    'libraries/mediaelement-and-player',
    'libraries/mediaelement-and-player-accessible-captions',
    'libraries/mediaelement-fullscreen-hook'
], function(Adapt, ComponentView) {


    var froogaloopAdded = false;

    // The following function is used to to prevent a memory leak in Internet Explorer
    // See: http://javascript.crockford.com/memory/leak.html
    function purge(d) {
        var a = d.attributes, i, l, n;
        if (a) {
            for (i = a.length - 1; i >= 0; i -= 1) {
                n = a[i].name;
                if (typeof d[n] === 'function') {
                    d[n] = null;
                }
            }
        }
        a = d.childNodes;
        if (a) {
            l = a.length;
            for (i = 0; i < l; i += 1) {
                purge(d.childNodes[i]);
            }
        }
    }

    var Media = ComponentView.extend({
      // convenient structure taken from browserChannelHandler
      _json_baseMessage: {
          composer: 'jsonMC_v1.0',
          timestamp: null,
          verb: null,
          object: null,
          objType: null,
          eventInfo: null,
          text: '',
          extraData: null,
        },

        events: {
            "click .media-inline-transcript-button": "onToggleInlineTranscript",
            "click .media-external-transcript-button": "onExternalTranscriptClicked"
        },

        preRender: function() {
            this.listenTo(Adapt, {
                'device:resize': this.onScreenSizeChanged,
                'device:changed': this.onDeviceChanged,
                'accessibility:toggle': this.onAccessibilityToggle,
                'media:stop': this.onMediaStop
            });

            _.bindAll(this, 'onMediaElementPlay', 'onMediaElementPause', 'onMediaElementEnded', 'onMediaElementTimeUpdate', 'onMediaElementSeeking');
            // bind also handlers related to trackingHub compatibility
            _.bindAll(this, 'onMediaElementSeeked', 'onMediaElementVolumechange', 'onComposeTkhmediaplayJSONMessage', 'onComposeTkhmediapauseJSONMessage', 'onComposeTkhmediaendedJSONMessage', 'onComposeTkhmediatimeupdateJSONMessage', 'onComposeTkhmediaseekedJSONMessage', 'onComposeTkhmediavolumechangeJSONMessage', 'onComposeTkhmediacaptionschangeJSONMessage');

            // set initial player state attributes
            this.model.set({
                '_isMediaEnded': false,
                '_isMediaPlaying': false
            });

            if (this.model.get('_media').source) {
                // Remove the protocol for streaming service.
                // This prevents conflicts with HTTP/HTTPS
                var media = this.model.get('_media');

                media.source = media.source.replace(/^https?\:/, "");

                this.model.set('_media', media); 
            }

            this.checkIfResetOnRevisit();
        },

        postRender: function() {
            this.setupPlayer();
        },

        setupPlayer: function() {
            if (!this.model.get('_playerOptions')) this.model.set('_playerOptions', {});

            var modelOptions = this.model.get('_playerOptions');

            if (modelOptions.pluginPath === undefined) modelOptions.pluginPath = 'assets/';
            if(modelOptions.features === undefined) {
                modelOptions.features = ['playpause','progress','current','duration'];
                if (this.model.get('_useClosedCaptions')) {
                    modelOptions.features.unshift('tracks');
                }
                if (this.model.get("_allowFullScreen") && !$("html").is(".ie9")) {
                    modelOptions.features.push('fullscreen');
                }
                if (this.model.get('_showVolumeControl')) {
                    modelOptions.features.push('volume');
                }
            }

            modelOptions.success = _.bind(this.onPlayerReady, this);

            if (this.model.get('_useClosedCaptions')) {
                modelOptions.startLanguage = this.model.get('_startLanguage') === undefined ? 'en' : this.model.get('_startLanguage');
            }

            var hasAccessibility = Adapt.config.has('_accessibility') && Adapt.config.get('_accessibility')._isActive
                ? true
                : false;

            if (hasAccessibility) {
                modelOptions.alwaysShowControls = true;
                modelOptions.hideVideoControlsOnLoad = false;
            }

            if (modelOptions.alwaysShowControls === undefined) {
                modelOptions.alwaysShowControls = false;
            }
            if (modelOptions.hideVideoControlsOnLoad === undefined) {
                modelOptions.hideVideoControlsOnLoad = true;
            }

            this.addMediaTypeClass();

            this.addThirdPartyFixes(modelOptions, _.bind(function createPlayer() {
                // create the player
                this.$('audio, video').mediaelementplayer(modelOptions);

                // We're streaming - set ready now, as success won't be called above
                try {
                    if (this.model.get('_media').source) {
                        this.$('.media-widget').addClass('external-source');
                    }
                } catch (e) {
                    console.log("ERROR! No _media property found in components.json for component " + this.model.get('_id'));
                } finally {
                    this.setReadyStatus();
                }
            }, this));
        },

        addMediaTypeClass: function() {
            var media = this.model.get("_media");
            if (media && media.type) {
                var typeClass = media.type.replace(/\//, "-");
                this.$(".media-widget").addClass(typeClass);
            }
        },

        addThirdPartyFixes: function(modelOptions, callback) {
            var media = this.model.get("_media");
            if (!media) return callback();

            switch (media.type) {
                case "video/vimeo":
                    modelOptions.alwaysShowControls = false;
                    modelOptions.hideVideoControlsOnLoad = true;
                    modelOptions.features = [];
                    if (froogaloopAdded) return callback();
                    Modernizr.load({
                        load: "assets/froogaloop.js",
                        complete: function() {
                            froogaloopAdded = true;
                            callback();
                        }
                    });
                    break;
                default:
                    callback();
            }
        },

        setupEventListeners: function() {
            this.completionEvent = (!this.model.get('_setCompletionOn')) ? 'play' : this.model.get('_setCompletionOn');

            if (this.completionEvent === 'inview') {
                this.$('.component-widget').on('inview', _.bind(this.inview, this));
            }

            // wrapper to check if preventForwardScrubbing is turned on.
            if ((this.model.get('_preventForwardScrubbing')) && (!this.model.get('_isComplete'))) {
                $(this.mediaElement).on({
                    'seeking': this.onMediaElementSeeking,
                    'timeupdate': this.onMediaElementTimeUpdate
                });
            }

            // handle other completion events in the event Listeners 
            // the first 3 are the original events used by this component
            // the rest are used for trackingHub and tkhub-xAPI compatiblity
            $(this.mediaElement).on({
                'play': this.onMediaElementPlay,
                'pause': this.onMediaElementPause,
                'ended': this.onMediaElementEnded,
                'seeked': this.onMediaSeeked,
                'volumechange': this.onMediaElementVolumeChange,
                'captionschange': this.onMediaElementCaptionsChange
            });
            // tell trackingHub to listen to events that we'll send from this component
            // use a different namespace to avoid conflicts
            if (Adapt.trackingHub) {
                var objTitle = this.model.get('title');
                console.log('ADDING CUSTOM EVENT LISTENERS TO TRACKINGHUB');
                Adapt.trackingHub.addCustomEventListener(this, objTitle, 'tkhmedia:play');
                Adapt.trackingHub.addCustomEventListener(this, objTitle, 'tkhmedia:pause');
                Adapt.trackingHub.addCustomEventListener(this, objTitle, 'tkhmedia:ended');
                Adapt.trackingHub.addCustomEventListener(this, objTitle, 'tkhmedia:timeupdate');
                Adapt.trackingHub.addCustomEventListener(this, objTitle, 'tkhmedia:seeked');
                Adapt.trackingHub.addCustomEventListener(this, objTitle, 'tkhmedia:volumechange');
                Adapt.trackingHub.addCustomEventListener(this, objTitle, 'tkhmedia:captionschange');

                // tell the known channel handlers to  add the custom composing functions that we provide in this component
                _.each(Adapt.trackingHub._channel_handlers, function(chhandler) {
                     if (chhandler._CHID == 'browserChannelHandler') {
                         chhandler._COMPOSER.addCustomComposingFunction(objTitle, 'tkhmedia:play', this.onComposeTkhmediaplayJSONMessage);
                         chhandler._COMPOSER.addCustomComposingFunction(objTitle, 'tkhmedia:pause', this.onComposeTkhmediapauseJSONMessage);
                         chhandler._COMPOSER.addCustomComposingFunction(objTitle, 'tkhmedia:ended', this.onComposeTkhmediaendedJSONMessage);
                         chhandler._COMPOSER.addCustomComposingFunction(objTitle, 'tkhmedia:timeupdate', this.onComposeTkhmediatimeupdateJSONMessage);
                         chhandler._COMPOSER.addCustomComposingFunction(objTitle, 'tkhmedia:seeked', this.onComposeTkhmediaseekedJSONMessage);
                         chhandler._COMPOSER.addCustomComposingFunction(objTitle, 'tkhmedia:volumechange', this.onComposeTkhmediavolumechangeJSONMessage);
                         chhandler._COMPOSER.addCustomComposingFunction(objTitle, 'tkhmedia:captionschange', this.onComposeTkhmediacaptionschangeJSONMessage);

                     } else if (chhandler._CHID == 'xapiChannelHandler') {
                         // chhandler._COMPOSER.addCustomComposingFunction('Adapt', 'navigation:terminate', termView.onComposeTerminateXapiMessage)

                     }
                }, this);
            }
        },

        onMediaElementPlay: function(event) {

            Adapt.trigger("media:stop", this);

            this.model.set({
                '_isMediaPlaying': true,
                '_isMediaEnded': false
            });

            if (this.completionEvent === 'play') {
                this.setCompletionStatus();
            }
            this.trigger("tkhmedia:play", this);
        },

        onMediaElementPause: function(event) {
            this.model.set('_isMediaPlaying', false);
            this.trigger("tkhmedia:pause", this);
        },

        onMediaElementEnded: function(event) {
            this.model.set('_isMediaEnded', true);

            if (this.completionEvent === 'ended') {
                this.setCompletionStatus();
            }
            this.trigger("tkhmedia:ended", this);
        },
        
        onMediaElementSeeking: function(event) {
            var maxViewed = this.model.get("_maxViewed");
            if(!maxViewed) {
                maxViewed = 0;
            }
            if (event.target.currentTime > maxViewed) {
                event.target.currentTime = maxViewed;
            }
        },

        onMediaElementTimeUpdate: function(event) {
            var maxViewed = this.model.get("_maxViewed");
            if (!maxViewed) {
                maxViewed = 0;
            }
            if (event.target.currentTime > maxViewed) {
                this.model.set("_maxViewed", event.target.currentTime);
            }
            this.trigger("tkhmedia:timeupdate", this);
        },

        onMediaElementSeeked: function(event) {
            this.trigger("tkhmedia:seeked", this);
        },

        onMediaElementVolumechange: function(event) {
            this.trigger("tkhmedia:volumechange", this);
        },

        onMediaElementCaptionschange: function(event) {
            this.trigger("tkhmedia:captionschange", this);
        },

        // Custom composing functions to make it compatible with browserChannelHandler

        baseJsonCompose: function(verb, args) {
            var message = _.clone(this._json_baseMessage);
            message.actor = Adapt.trackingHub.userInfo;
            message.verb = verb;
            // message.object = Adapt.trackingHub.getElementKey(args);
            message.object = Adapt.trackingHub.getElementKey(this.model);
            // message.objType = args.get('_type');
            message.objType = this.model.get('_type');
            message.text = message.verb + ' ' + message.objType + ' ' + message.object;
            return (message);
        },

        onComposeTkhmediaplayJSONMessage: function(args) {
            return this.baseJsonCompose('played', args);
        },

        onComposeTkhmediapauseJSONMessage: function(args) {
            return this.baseJsonCompose('paused', args);
        },

        onComposeTkhmediaendedJSONMessage: function(args) {
            return this.baseJsonCompose('mediaEnded', args);
        },

        onComposeTkhmediatimeupdateJSONMessage: function(args) {
            return this.baseJsonCompose('timeUpdated', args);
        },

        onComposeTkhmediaseekedJSONMessage: function(args) {
            return this.baseJsonCompose('seeked', args);
        },

        onComposeTkhmediavolumechangeJSONMessage: function(args) {
            return this.baseJsonCompose('volumeChanged', args);
        },

        onComposeTkhmediacaptionschangeJSONMessage: function(args) {
            return this.baseJsonCompose('captionsChanged', args);
        },

        // Custom composing functions to make it compatible with xapiChannelHandler
        // none yet

        // Overrides the default play/pause functionality to stop accidental playing on touch devices
        setupPlayPauseToggle: function() {
            // bit sneaky, but we don't have a this.mediaElement.player ref on iOS devices
            var player = this.mediaElement.player;

            if (!player) {
                console.log("Media.setupPlayPauseToggle: OOPS! there's no player reference.");
                return;
            }

            // stop the player dealing with this, we'll do it ourselves
            player.options.clickToPlayPause = false;

            this.onOverlayClick = _.bind(this.onOverlayClick, this);
            this.onMediaElementClick = _.bind(this.onMediaElementClick, this);

            // play on 'big button' click
            this.$('.mejs-overlay-button').on("click", this.onOverlayClick);

            // pause on player click
            this.$('.mejs-mediaelement').on("click", this.onMediaElementClick);
        },
        
        onMediaStop: function(view) {

            // Make sure this view isn't triggering media:stop
            if (view && view.cid === this.cid) return;

            var player = this.mediaElement.player;
            if (!player) return;
            
            player.pause();
        },

        onOverlayClick: function() {
            var player = this.mediaElement.player;
            if (!player) return;

            player.play();
        },

        onMediaElementClick: function(event) {
            var player = this.mediaElement.player;
            if (!player) return;

            var isPaused = player.media.paused;
            if(!isPaused) player.pause();
        },

        checkIfResetOnRevisit: function() {
            var isResetOnRevisit = this.model.get('_isResetOnRevisit');

            // If reset is enabled set defaults
            if (isResetOnRevisit) {
                this.model.reset(isResetOnRevisit);
            }
        },

        inview: function(event, visible, visiblePartX, visiblePartY) {
            if (visible) {
                if (visiblePartY === 'top') {
                    this._isVisibleTop = true;
                } else if (visiblePartY === 'bottom') {
                    this._isVisibleBottom = true;
                } else {
                    this._isVisibleTop = true;
                    this._isVisibleBottom = true;
                }

                if (this._isVisibleTop && this._isVisibleBottom) {
                    this.$('.component-inner').off('inview');
                    this.setCompletionStatus();
                }
            }
        },

        remove: function() {
            this.$('.mejs-overlay-button').off("click", this.onOverlayClick);
            this.$('.mejs-mediaelement').off("click", this.onMediaElementClick);

            var modelOptions = this.model.get('_playerOptions');
            delete modelOptions.success;

            var media = this.model.get("_media");
            if (media) {
                switch (media.type) {
                case "video/vimeo":
                    this.$("iframe")[0].isRemoved = true;
                }
            }

            if ($("html").is(".ie8")) {
                var obj = this.$("object")[0];
                if (obj) {
                    obj.style.display = "none";
                }
            }
            if (this.mediaElement && this.mediaElement.player) {
                var player_id = this.mediaElement.player.id;

                purge(this.$el[0]);
                this.mediaElement.player.remove();

                if (mejs.players[player_id]) {
                    delete mejs.players[player_id];
                }
            }

            if (this.mediaElement) {
                $(this.mediaElement).off({
                    'play': this.onMediaElementPlay,
                    'pause': this.onMediaElementPause,
                    'ended': this.onMediaElementEnded,
                    'seeking': this.onMediaElementSeeking,
                    'timeupdate': this.onMediaElementTimeUpdate,
                    'seeked': this.onMediaSeeked,
                    'volumechange': this.onMediaVolumeChange,
                    'captionschange': this.onMediaCaptionsChange
                });
                // tell trackingHub to stop listening to events from this object
                console.log('REMOVING CUSTOM EVENT LISTENERS TO TRACKINGHUB');
                Adapt.trackingHub.removeCustomEventListener(this, 'tkhmedia:play');
                Adapt.trackingHub.removeCustomEventListener(this, 'tkhmedia:pause');
                Adapt.trackingHub.removeCustomEventListener(this, 'tkhmedia:ended');
                Adapt.trackingHub.removeCustomEventListener(this, 'tkhmedia:timeupdate');
                Adapt.trackingHub.removeCustomEventListener(this, 'tkhmedia:seeked');
                Adapt.trackingHub.removeCustomEventListener(this, 'tkhmedia:volumechange');
                Adapt.trackingHub.removeCustomEventListener(this, 'tkhmedia:captionschange');

                this.mediaElement.src = "";
                $(this.mediaElement.pluginElement).remove();
                delete this.mediaElement;
            }

            ComponentView.prototype.remove.call(this);
        },

        onDeviceChanged: function() {
            if (this.model.get('_media').source) {
                this.$('.mejs-container').width(this.$('.component-widget').width());
            }
        },

        onPlayerReady: function (mediaElement, domObject) {
            this.mediaElement = mediaElement;

            if (!this.mediaElement.player) {
                this.mediaElement.player =  mejs.players[this.$('.mejs-container').attr('id')];
            }

            var hasTouch = mejs.MediaFeatures.hasTouch;
            if (hasTouch) {
                this.setupPlayPauseToggle();
            }

            this.addThirdPartyAfterFixes();

            if(this.model.has('_startVolume')) {
                // Setting the start volume only works with the Flash-based player if you do it here rather than in setupPlayer
                this.mediaElement.player.setVolume(parseInt(this.model.get('_startVolume'))/100);
            }

            this.setReadyStatus();
            this.setupEventListeners();
        },

        addThirdPartyAfterFixes: function() {
            var media = this.model.get("_media");
            switch (media.type) {
            case "video/vimeo":
                this.$(".mejs-container").attr("tabindex", 0);
            }
        },

        onScreenSizeChanged: function() {
            this.$('audio, video').width(this.$('.component-widget').width());
        },

        onAccessibilityToggle: function() {
           this.showControls();
        },

        onToggleInlineTranscript: function(event) {
            if (event) event.preventDefault();
            var $transcriptBodyContainer = this.$(".media-inline-transcript-body-container");
            var $button = this.$(".media-inline-transcript-button");

            if ($transcriptBodyContainer.hasClass("inline-transcript-open")) {
                $transcriptBodyContainer.stop(true,true).slideUp(function() {
                    $(window).resize();
                });
                $transcriptBodyContainer.removeClass("inline-transcript-open");
                $button.html(this.model.get("_transcript").inlineTranscriptButton);
            } else {
                $transcriptBodyContainer.stop(true,true).slideDown(function() {
                    $(window).resize();
                }).a11y_focus();
                $transcriptBodyContainer.addClass("inline-transcript-open");
                $button.html(this.model.get("_transcript").inlineTranscriptCloseButton);

                if (this.model.get('_transcript')._setCompletionOnView !== false) {
                    this.setCompletionStatus();
                }
            }
        },

        onExternalTranscriptClicked: function(event) {
            if (this.model.get('_transcript')._setCompletionOnView !== false) {
                this.setCompletionStatus();
            }
        },

        showControls: function() {
            var hasAccessibility = Adapt.config.has('_accessibility') && Adapt.config.get('_accessibility')._isActive
                ? true
                : false;

            if (hasAccessibility) {
                if (!this.mediaElement.player) return;

                var player = this.mediaElement.player;

                player.options.alwaysShowControls = true;
                player.options.hideVideoControlsOnLoad = false;
                player.enableControls();
                player.showControls();

                this.$('.mejs-playpause-button button').attr({
                    "role": "button"
                });
                var screenReaderVideoTagFix = $("<div role='region' aria-label='.'>");
                this.$('.mejs-playpause-button').prepend(screenReaderVideoTagFix);

                this.$('.mejs-time, .mejs-time-rail').attr({
                    "aria-hidden": "true"
                });
            }
        }

    });

    Adapt.register('media', Media);

    return Media;

});
