// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const GDesktopEnums = imports.gi.GDesktopEnums;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GnomeDesktop = imports.gi.GnomeDesktop;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Signals = imports.signals;

const Config = imports.misc.config;
const Main = imports.ui.main;
const Params = imports.misc.params;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;

const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';
const PRIMARY_COLOR_KEY = 'primary-color';
const SECONDARY_COLOR_KEY = 'secondary-color';
const COLOR_SHADING_TYPE_KEY = 'color-shading-type';
const BACKGROUND_STYLE_KEY = 'picture-options';
const PICTURE_OPACITY_KEY = 'picture-opacity';
const PICTURE_URI_KEY = 'picture-uri';
const DEFAULT_CONFIGS_DIR = Config.DATADIR + '/EndlessOS/personality-defaults';
const BACKGROUND_NAME_BASE = 'desktop-background';

const FADE_ANIMATION_TIME = 1.0;

// These parameters affect how often we redraw.
// The first is how different (percent crossfaded) the slide show
// has to look before redrawing and the second is the minimum
// frequency (in seconds) we're willing to wake up
const ANIMATION_OPACITY_STEP_INCREMENT = 4.0;
const ANIMATION_MIN_WAKEUP_INTERVAL = 1.0;

let _backgroundCache = null;

function _fileEqual0(file1, file2) {
    if (file1 == file2)
        return true;

    if (!file1 || !file2)
        return false;

    return file1.equal(file2);
}

const BackgroundCache = new Lang.Class({
    Name: 'BackgroundCache',

    _init: function() {
       this._patterns = [];
       this._images = [];
       this._pendingFileLoads = [];
       this._fileMonitors = {};
    },

    getPatternContent: function(params) {
        params = Params.parse(params, { monitorIndex: 0,
                                        color: null,
                                        secondColor: null,
                                        shadingType: null,
                                        effects: Meta.BackgroundEffects.NONE });

        let content = null;

        let candidateContent = null;
        for (let i = 0; i < this._patterns.length; i++) {
            if (this._patterns[i].get_shading() != params.shadingType)
                continue;

            if (!params.color.equal(this._patterns[i].get_color()))
                continue;

            if (params.shadingType != GDesktopEnums.BackgroundShading.SOLID &&
                !params.secondColor.equal(this._patterns[i].get_second_color()))
                continue;

            candidateContent = this._patterns[i];

            if (params.effects != this._patterns[i].effects)
                continue;

            break;
        }

        if (candidateContent) {
            content = candidateContent.copy(params.monitorIndex, params.effects);
        } else {
            content = new Meta.Background({ meta_screen: global.screen,
                                            monitor: params.monitorIndex,
                                            effects: params.effects });

            if (params.shadingType == GDesktopEnums.BackgroundShading.SOLID) {
                content.load_color(params.color);
            } else {
                content.load_gradient(params.shadingType, params.color, params.secondColor);
            }
        }

        this._patterns.push(content);
        return content;
    },

    _monitorFile: function(file) {
        let key = file.hash();
        if (this._fileMonitors[key])
            return;

        let monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
        let signalId = monitor.connect('changed',
                                       Lang.bind(this, function() {
                                           this._removeAllImages(file);
                                           this.emit('file-changed', file);
                                       }));

        this._fileMonitors[key] = { monitor: monitor,
                                    signalId: signalId };
    },

    _removeContent: function(contentList, content) {
        let index = contentList.indexOf(content);
        if (index < 0)
            throw new Error("Trying to remove invalid content: " + content);
        contentList.splice(index, 1);
    },

    removePatternContent: function(content) {
        this._removeContent(this._patterns, content);
    },

    removeImageContent: function(content) {
        let file = content.get_file();
        let key = file.hash();

        let hasOtherUsers = this._images.some(function(content) { return _fileEqual0(file, content.get_file()); });
        if (!hasOtherUsers) {
            let monitorObj = this._fileMonitors[key];
            monitorObj.monitor.disconnect(monitorObj.signalId);

            delete this._fileMonitors[key];
        }

        this._removeContent(this._images, content);
    },

    _removeAllImages: function(file) {
        let images = this._images.filter(function(image) {
            return _fileEqual0(image.get_file(), file);
        });

        images.forEach(Lang.bind(this, function(image) {
            this.removeImageContent(image);
        }));
    },

    _attachCallerToFileLoad: function(caller, fileLoad) {
        fileLoad.callers.push(caller);

        if (!caller.cancellable)
            return;

        caller.cancellable.connect(Lang.bind(this, function() {
            let idx = fileLoad.callers.indexOf(caller);
            fileLoad.callers.splice(idx, 1);

            if (fileLoad.callers.length == 0) {
                fileLoad.cancellable.cancel();

                let idx = this._pendingFileLoads.indexOf(fileLoad);
                this._pendingFileLoads.splice(idx, 1);
            }
        }));
    },

    _loadImageContent: function(params) {
        params = Params.parse(params, { monitorIndex: 0,
                                        style: null,
                                        file: null,
                                        effects: Meta.BackgroundEffects.NONE,
                                        cancellable: null,
                                        onFinished: null });

        let caller = { monitorIndex: params.monitorIndex,
                       effects: params.effects,
                       cancellable: params.cancellable,
                       onFinished: params.onFinished };

        for (let i = 0; i < this._pendingFileLoads.length; i++) {
            let fileLoad = this._pendingFileLoads[i];

            if (_fileEqual0(fileLoad.file, params.file) &&
                fileLoad.style == params.style) {
                this._attachCallerToFileLoad(caller, fileLoad);
                return;
            }
        }

        let fileLoad = { file: params.file,
                         style: params.style,
                         cancellable: new Gio.Cancellable(),
                         callers: [] };
        this._attachCallerToFileLoad(caller, fileLoad);
        this._pendingFileLoads.push(fileLoad);

        let content = new Meta.Background({ meta_screen: global.screen });

        content.load_file_async(params.file,
                                params.style,
                                params.cancellable,
                                Lang.bind(this,
                                          function(object, result) {
                                              try {
                                                  content.load_file_finish(result);

                                                  this._monitorFile(params.file);
                                              } catch(e) {
                                                  content = null;
                                              }

                                              for (let i = 0; i < fileLoad.callers.length; i++) {
                                                  let caller = fileLoad.callers[i];
                                                  if (caller.onFinished) {
                                                      let newContent;

                                                      if (content) {
                                                          newContent = content.copy(caller.monitorIndex, caller.effects);
                                                          this._images.push(newContent);
                                                      }

                                                      caller.onFinished(newContent);
                                                  }
                                              }

                                              let idx = this._pendingFileLoads.indexOf(fileLoad);
                                              this._pendingFileLoads.splice(idx, 1);
                                          }));
    },

    getImageContent: function(params) {
        params = Params.parse(params, { monitorIndex: 0,
                                        style: null,
                                        file: null,
                                        effects: Meta.BackgroundEffects.NONE,
                                        cancellable: null,
                                        onFinished: null });

        let content = null;

        let candidateContent = null;
        for (let i = 0; i < this._images.length; i++) {
            if (this._images[i].get_style() != params.style)
                continue;

            if (!_fileEqual0(this._images[i].get_file(), params.file))
                continue;

            if (params.style == GDesktopEnums.BackgroundStyle.SPANNED &&
                this._images[i].monitor != params.monitorIndex)
                continue;

            candidateContent = this._images[i];

            if (params.effects != this._images[i].effects)
                continue;

            break;
        }

        if (candidateContent) {
            content = candidateContent.copy(params.monitorIndex, params.effects);

            if (params.cancellable && params.cancellable.is_cancelled())
                content = null;
            else
                this._images.push(content);

            if (params.onFinished)
                params.onFinished(content);
        } else {
            this._loadImageContent({ file: params.file,
                                     style: params.style,
                                     effects: params.effects,
                                     monitorIndex: params.monitorIndex,
                                     cancellable: params.cancellable,
                                     onFinished: params.onFinished });

        }
    },

    getAnimation: function(params) {
        params = Params.parse(params, { file: null,
                                        onLoaded: null });

        if (_fileEqual0(this._animationFile, params.file)) {
            if (params.onLoaded) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, Lang.bind(this, function() {
                    params.onLoaded(this._animation);
                }));
            }
        }

        let animation = new Animation({ file: params.file });

        animation.load(Lang.bind(this, function() {
                           this._monitorFile(params.file);
                           this._animationFile = params.file;
                           this._animation = animation;

                           if (params.onLoaded) {
                               GLib.idle_add(GLib.PRIORITY_DEFAULT, Lang.bind(this, function() {
                                   params.onLoaded(this._animation);
                               }));
                           }
                       }));
    }
});
Signals.addSignalMethods(BackgroundCache.prototype);

function getBackgroundCache() {
    if (!_backgroundCache)
        _backgroundCache = new BackgroundCache();
    return _backgroundCache;
}

const Background = new Lang.Class({
    Name: 'Background',

    _init: function(params) {
        params = Params.parse(params, { monitorIndex: 0,
                                        layoutManager: Main.layoutManager,
                                        effects: Meta.BackgroundEffects.NONE });
        this.actor = new Meta.BackgroundGroup();
        this.actor._delegate = this;

        this._destroySignalId = this.actor.connect('destroy',
                                                   Lang.bind(this, this._destroy));

        this._settings = new Gio.Settings({ schema: BACKGROUND_SCHEMA });
        this._monitorIndex = params.monitorIndex;
        this._layoutManager = params.layoutManager;
        this._effects = params.effects;
        this._fileWatches = {};
        this._pattern = null;
        // contains a single image for static backgrounds and
        // two images (from and to) for slide shows
        this._images = {};

        this._brightness = 1.0;
        this._vignetteSharpness = 0.2;
        this._cancellable = new Gio.Cancellable();
        this.isLoaded = false;

        this._settingsChangedSignalId = this._settings.connect('changed', Lang.bind(this, function() {
                                            this.emit('changed');
                                        }));

        this._load();
    },

    _destroy: function() {
        this._cancellable.cancel();

        if (this._updateAnimationTimeoutId) {
            GLib.source_remove (this._updateAnimationTimeoutId);
            this._updateAnimationTimeoutId = 0;
        }

        let i;
        let keys = Object.keys(this._fileWatches);
        for (i = 0; i < keys.length; i++) {
            this._cache.disconnect(this._fileWatches[keys[i]]);
        }
        this._fileWatches = null;

        if (this._pattern) {
            if (this._pattern.content)
                this._cache.removePatternContent(this._pattern.content);

            this._pattern.destroy();
            this._pattern = null;
        }

        keys = Object.keys(this._images);
        for (i = 0; i < keys.length; i++) {
            let actor = this._images[keys[i]];

            if (actor.content)
                this._cache.removeImageContent(actor.content);

            actor.destroy();
            this._images[keys[i]] = null;
        }

        this.actor.disconnect(this._destroySignalId);
        this._destroySignalId = 0;

        if (this._settingsChangedSignalId != 0)
            this._settings.disconnect(this._settingsChangedSignalId);
        this._settingsChangedSignalId = 0;
    },

    _setLoaded: function() {
        if (this.isLoaded)
            return;

        this.isLoaded = true;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, Lang.bind(this, function() {
            this.emit('loaded');
            return false;
        }));
    },

    _loadPattern: function() {
        let colorString, res, color, secondColor;

        colorString = this._settings.get_string(PRIMARY_COLOR_KEY);
        [res, color] = Clutter.Color.from_string(colorString);
        colorString = this._settings.get_string(SECONDARY_COLOR_KEY);
        [res, secondColor] = Clutter.Color.from_string(colorString);

        let shadingType = this._settings.get_enum(COLOR_SHADING_TYPE_KEY);

        let content = this._cache.getPatternContent({ monitorIndex: this._monitorIndex,
                                                      effects: this._effects,
                                                      color: color,
                                                      secondColor: secondColor,
                                                      shadingType: shadingType });

        this._pattern = new Meta.BackgroundActor();
        this.actor.add_child(this._pattern);

        this._pattern.content = content;
    },

    _watchCacheFile: function(file) {
        let key = file.hash();
        if (this._fileWatches[key])
            return;

        let signalId = this._cache.connect('file-changed',
                                           Lang.bind(this, function(cache, changedFile) {
                                               if (changedFile.equal(file)) {
                                                   this.emit('changed');
                                               }
                                           }));
        this._fileWatches[key] = signalId;
    },

    _ensureImage: function(index) {
        if (this._images[index])
            return;

        let actor = new Meta.BackgroundActor();

        // The background pattern is the first actor in
        // the group, and all images should be above that.
        this.actor.insert_child_at_index(actor, index + 1);
        this._images[index] = actor;
    },

    _updateImage: function(index, content, file) {
        content.brightness = this._brightness;
        content.vignette_sharpness = this._vignetteSharpness;

        let image = this._images[index];
        if (image.content)
            this._cache.removeImageContent(image.content);
        image.content = content;
        this._watchCacheFile(file);

        let needs_pattern = true;
        let [monitorWidth, monitorHeight] = this.actor.get_size();
        let keys = Object.keys(this._images);

        for (let i = 0; i < keys.length; i++) {
            let image = this._images[keys[i]];
            let rect = image.content.get_texture_rect();
            if (rect.get_width() >= monitorWidth  &&
                rect.get_height() >= monitorHeight &&
                !image.content.get_has_alpha()) {
                needs_pattern = false;
                break;
            }
        }

        if (needs_pattern)
            this._pattern.show();
        else
            this._pattern.hide();
    },

    _updateAnimationProgress: function() {
        if (this._images[1])
            this._images[1].opacity = this._animation.transitionProgress * 255;

        this._queueUpdateAnimation();
    },

    _updateAnimation: function() {
        this._updateAnimationTimeoutId = 0;

        this._animation.update(this._layoutManager.monitors[this._monitorIndex]);
        let files = this._animation.keyFrameFiles;

        if (files.length == 0) {
            this._setLoaded();
            this._queueUpdateAnimation();
            return;
        }

        let numPendingImages = files.length;
        for (let i = 0; i < files.length; i++) {
            if (this._images[i] && this._images[i].content &&
                _fileEqual0(this._images[i].content.get_file(), files[i])) {

                numPendingImages--;
                if (numPendingImages == 0)
                    this._updateAnimationProgress();
                continue;
            }
            this._cache.getImageContent({ monitorIndex: this._monitorIndex,
                                          effects: this._effects,
                                          style: this._style,
                                          file: files[i],
                                          cancellable: this._cancellable,
                                          onFinished: Lang.bind(this, function(content, i) {
                                              numPendingImages--;

                                              if (!content) {
                                                  this._setLoaded();
                                                  if (numPendingImages == 0)
                                                      this._updateAnimationProgress();
                                                  return;
                                              }

                                              this._ensureImage(i);
                                              this._updateImage(i, content, files[i]);

                                              if (numPendingImages == 0) {
                                                  this._setLoaded();
                                                  this._updateAnimationProgress();
                                              }
                                          }, i)
                                        });
        }
    },

    _queueUpdateAnimation: function() {
        if (this._updateAnimationTimeoutId != 0)
            return;

        if (!this._cancellable || this._cancellable.is_cancelled())
            return;

        if (!this._animation.transitionDuration)
            return;

        let nSteps = 255 / ANIMATION_OPACITY_STEP_INCREMENT;
        let timePerStep = (this._animation.transitionDuration * 1000) / nSteps;

        let interval = Math.max(ANIMATION_MIN_WAKEUP_INTERVAL * 1000,
                                timePerStep);

        if (interval > GLib.MAXUINT32)
            return;

        this._updateAnimationTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                                                      interval,
                                                      Lang.bind(this, function() {
                                                                    this._updateAnimationTimeoutId = 0;
                                                                    this._updateAnimation();
                                                                    return false;
                                                                }));
    },

    _loadAnimation: function(file) {
        this._cache.getAnimation({ file: file,
                                   onLoaded: Lang.bind(this, function(animation) {
                                       this._animation = animation;

                                       if (!this._animation || this._cancellable.is_cancelled()) {
                                           this._setLoaded();
                                           return;
                                       }

                                       this._updateAnimation();
                                       this._watchCacheFile(file);
                                   })
                                 });
    },

    _loadImage: function(file) {
        this._cache.getImageContent({ monitorIndex: this._monitorIndex,
                                      effects: this._effects,
                                      style: this._style,
                                      file: file,
                                      cancellable: this._cancellable,
                                      onFinished: Lang.bind(this, function(content) {
                                          if (content) {
                                              this._ensureImage(0);
                                              this._updateImage(0, content, file);
                                          }
                                          this._setLoaded();
                                      })
                                    });
    },

    _loadFile: function(file) {
        if (file.get_basename().endsWith('.xml'))
            this._loadAnimation(file);
        else
            this._loadImage(file);
    },

    _getDefaultBackgroundFile: function() {
        let personality = Util.getPersonality();

        let files = [];
        files.push(GLib.build_filenamev([DEFAULT_CONFIGS_DIR,
            BACKGROUND_NAME_BASE + '-' + personality + '.jpg']));

        files.push(GLib.build_filenamev([DEFAULT_CONFIGS_DIR,
            BACKGROUND_NAME_BASE + '-default.jpg']));

        for (let i = 0; i < files.length; i++) {
            if (GLib.file_test(files[i], GLib.FileTest.EXISTS)) {
                return Gio.File.new_for_path(files[i]);
            }
        }

        log('No default background images found!');
        return '';
    },

    _load: function () {
        this._cache = getBackgroundCache();

        this._loadPattern();

        this._style = this._settings.get_enum(BACKGROUND_STYLE_KEY);
        if (this._style == GDesktopEnums.BackgroundStyle.NONE) {
            this._setLoaded();
            return;
        }

        let uri = this._settings.get_string(PICTURE_URI_KEY);

        let file;
        // This URI indicates that the per-personality default should be used
        if (uri === 'eos:///default') {
            file = this._getDefaultBackgroundFile();
        } else {
            file = Gio.File.new_for_uri(uri);
        }

        this._loadFile(file);
    },

    get brightness() {
        return this._brightness;
    },

    set brightness(factor) {
        this._brightness = factor;
        if (this._pattern && this._pattern.content)
            this._pattern.content.brightness = factor;

        let keys = Object.keys(this._images);
        for (let i = 0; i < keys.length; i++) {
            let image = this._images[keys[i]];
            if (image && image.content)
                image.content.brightness = factor;
        }
    },

    get vignetteSharpness() {
        return this._vignetteSharpness;
    },

    set vignetteSharpness(sharpness) {
        this._vignetteSharpness = sharpness;
        if (this._pattern && this._pattern.content)
            this._pattern.content.vignette_sharpness = sharpness;

        let keys = Object.keys(this._images);
        for (let i = 0; i < keys.length; i++) {
            let image = this._images[keys[i]];
            if (image && image.content)
                image.content.vignette_sharpness = sharpness;
        }
    }
});
Signals.addSignalMethods(Background.prototype);

const SystemBackground = new Lang.Class({
    Name: 'SystemBackground',

    _init: function() {
        this._cache = getBackgroundCache();
        this.actor = new Meta.BackgroundActor();

        this._cache.getImageContent({ style: GDesktopEnums.BackgroundStyle.WALLPAPER,
                                      file: Gio.File.new_for_uri('resource:///org/gnome/shell/theme/noise-texture.png'),
                                      effects: Meta.BackgroundEffects.NONE,
                                      onFinished: Lang.bind(this, function(content) {
                                          this.actor.content = content;
                                          this.emit('loaded');
                                      })
                                    });

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
    },

    _onDestroy: function() {
        let content = this.actor.content;

        if (content)
            this._cache.removeImageContent(content);
    },
});
Signals.addSignalMethods(SystemBackground.prototype);

const Animation = new Lang.Class({
    Name: 'Animation',

    _init: function(params) {
        params = Params.parse(params, { file: null });

        this.file = params.file;
        this.keyFrameFiles = [];
        this.transitionProgress = 0.0;
        this.transitionDuration = 0.0;
        this.loaded = false;
    },

    load: function(callback) {
        this._show = new GnomeDesktop.BGSlideShow({ filename: this.file.get_path() });

        this._show.load_async(null,
                              Lang.bind(this,
                                        function(object, result) {
                                            this.loaded = true;
                                            if (callback)
                                                callback();
                                        }));
    },

    update: function(monitor) {
        this.keyFrameFiles = [];

        if (!this._show)
            return;

        if (this._show.get_num_slides() < 1)
            return;

        let [progress, duration, isFixed, filename1, filename2] = this._show.get_current_slide(monitor.width, monitor.height);

        this.transitionDuration = duration;
        this.transitionProgress = progress;

        if (filename1)
            this.keyFrameFiles.push(Gio.File.new_for_path(filename1));

        if (filename2)
            this.keyFrameFiles.push(Gio.File.new_for_path(filename2));
    },
});
Signals.addSignalMethods(Animation.prototype);

const BackgroundManager = new Lang.Class({
    Name: 'BackgroundManager',

    _init: function(params) {
        params = Params.parse(params, { container: null,
                                        layoutManager: Main.layoutManager,
                                        monitorIndex: null,
                                        effects: Meta.BackgroundEffects.NONE,
                                        controlPosition: true });

        this._container = params.container;
        this._layoutManager = params.layoutManager;
        this._effects = params.effects;
        this._monitorIndex = params.monitorIndex;
        this._controlPosition = params.controlPosition;

        this.background = this._createBackground();
        this._newBackground = null;
    },

    destroy: function() {
        if (this._newBackground) {
            this._newBackground.actor.destroy();
            this._newBackground = null;
        }

        if (this.background) {
            this.background.actor.destroy();
            this.background = null;
        }
    },

    _updateBackground: function() {
        let newBackground = this._createBackground();
        newBackground.vignetteSharpness = this.background.vignetteSharpness;
        newBackground.brightness = this.background.brightness;
        newBackground.visible = this.background.visible;

        newBackground.loadedSignalId = newBackground.connect('loaded',
            Lang.bind(this, function() {
                newBackground.disconnect(newBackground.loadedSignalId);
                newBackground.loadedSignalId = 0;

                if (this._newBackground != newBackground) {
                    /* Not interesting, we queued another load */
                    newBackground.actor.destroy();
                    return;
                }

                Tweener.addTween(this.background.actor,
                                 { opacity: 0,
                                   time: FADE_ANIMATION_TIME,
                                   transition: 'easeOutQuad',
                                   onComplete: Lang.bind(this, function() {
                                       this.background.actor.destroy();
                                       this.background = newBackground;
                                       this._newBackground = null;

                                       this.emit('changed');
                                   })
                                 });
        }));

        this._newBackground = newBackground;
    },

    _createBackground: function() {
        let background = new Background({ monitorIndex: this._monitorIndex,
                                          layoutManager: this._layoutManager,
                                          effects: this._effects });
        this._container.add_child(background.actor);

        let monitor = this._layoutManager.monitors[this._monitorIndex];

        if (monitor) {
            background.actor.set_size(monitor.width, monitor.height);
            if (this._controlPosition) {
                background.actor.set_position(monitor.x, monitor.y);
            }
        }

        if (this._controlPosition) {
            background.actor.lower_bottom();
        }

        background.changeSignalId = background.connect('changed', Lang.bind(this, function() {
            background.disconnect(background.changeSignalId);
            background.changeSignalId = 0;
            this._updateBackground();
        }));

        background.actor.connect('destroy', Lang.bind(this, function() {
            if (background.changeSignalId)
                background.disconnect(background.changeSignalId);

            if (background.loadedSignalId)
                background.disconnect(background.loadedSignalId);
        }));

        return background;
    },
});
Signals.addSignalMethods(BackgroundManager.prototype);
