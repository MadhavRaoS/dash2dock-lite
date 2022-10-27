'use strict';

const { St, Shell, Gio, GLib, Gtk, Meta, Clutter } = imports.gi;

const Main = imports.ui.main;
const Dash = imports.ui.dash.Dash;
const Fav = imports.ui.appFavorites;
const Layout = imports.ui.layout;
const Point = imports.gi.Graphene.Point;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { schemaId, settingsKeys, SettingsKeys } = Me.imports.preferences.keys;

const Animator = Me.imports.animator.Animator;
const AutoHide = Me.imports.autohide.AutoHide;
const Services = Me.imports.services.Services;
const xDot = Me.imports.apps.dot.xDot;
const xWMControl = Me.imports.apps.wmcontrol.xWMControl;

const ColorEffect = Me.imports.effects.color_effect.ColorEffect;

const setTimeout = Me.imports.utils.setTimeout;
const setInterval = Me.imports.utils.setInterval;
const runTests = Me.imports.diagnostics.runTests;

const SERVICES_UPDATE_INTERVAL = 2500;

class Extension {
  enable() {
    this._imports = Me.imports;

    this.listeners = [];
    this.scale = 1.0;
    this.scale_icons = 0.5;
    this.xDot = xDot;
    this.xWMControl = xWMControl;

    Main._d2dl = this;

    this._enableSettings();
    this._queryDisplay();

    // setup the dash container
    this.dashContainer = new St.BoxLayout({
      name: 'dashContainer',
      vertical: true,
    });
    this.dashContainer.delegate = this;

    // todo
    this.reuseExistingDash = true;
    if (this.reuseExistingDash) {
      this.dash = Main.overview.dash;
    } else {
      this.dash = new Dash();
      this.dash.set_name('dash');
      this.dash.add_style_class_name('overview');
    }

    this.dashContainer.visible = false;
    this.dash.visible = false;
    if (this.dash._showAppsIcon) {
      this.dash._showAppsIcon.visible = false;
    }

    // color effects
    this._backgroundEffect = new ColorEffect({
      name: 'dash_background',
      color: [0, 0, 0, 0.2],
    });
    this.dash._background.add_effect_with_name(
      'dash_background',
      this._backgroundEffect
    );

    this.dashContainer.dash = this.dash;
    if (this.dash.get_parent()) {
      this.dash.get_parent().remove_child(this.dash);
    }
    this.dashContainer.add_child(this.dash);

    // service
    this.services = new Services();
    this.services.extension = this;

    // animator
    this.animator = new Animator();
    this.animator.extension = this;
    this.animator.dashContainer = this.dashContainer;

    // autohider
    this.autohider = new AutoHide();
    this.autohider.extension = this;
    this.autohider.animator = this.animator;
    this.autohider.dashContainer = this.dashContainer;

    // todo follow animator and autohider protocol
    this.services.enable();

    this.listeners = [this.animator, this.autohider, this.services];

    this._onCheckServices();

    this._updateShrink();
    this._updateBackgroundColors();
    this._updateLayout();

    this._updateAutohide();
    this._updateAnimation();
    this.animator._iconsContainer.visible = false;
    this.animator._dotsContainer.visible = false;

    this._updateCss();
    this._updateTrashIcon();

    this._addEvents();

    this.startUp();
  }

  disable() {
    this._removeEvents();
    this._disableSettings();

    this._updateShrink(true);
    this._updateBackgroundColors(true);
    this._updateLayout(true);
    this._updateAnimation(true);
    this._updateAutohide(true);
    this._updateCss(true);

    this.dash._background.remove_effect_by_name('dash_background');

    this.dashContainer.remove_child(this.dash);
    if (this.reuseExistingDash) {
      Main.uiGroup
        .find_child_by_name('overview')
        .first_child.add_child(this.dash);
    }

    Main.layoutManager.removeChrome(this.dashContainer);
    delete this.dashContainer;
    this.dashContainer = null;

    delete this.animator;
    this.animator = null;

    if (this.dash.showAppsButton && this.dash.showAppsButton._checkEventId) {
      this.dash.showAppsButton.disconnect(
        this.dash.showAppsButton._checkEventId
      );
      this.dash.showAppsButton._checkEventId = null;
    }

    this.services.disable();
    delete this.services;
    this.services = null;
  }

  startUp() {
    this._updateLayout();
    this.oneShotStartupCompleteId = setTimeout(() => {
      this._updateLayout();
      this._onEnterEvent();
      this.oneShotStartupCompleteId = null;

      this.dashContainer.visible = true;
      this.dash.visible = true;
      if (this.animator._iconsContainer) {
        this.animator._iconsContainer.visible = true;
        this.animator._dotsContainer.visible = true;
      }

      // ubuntu
      if (!this._didFirstRun) {
        this.oneShotStartupCompleteId = setTimeout(() => {
          this._updateLayout();
          this._onEnterEvent();
          this.oneShotStartupCompleteId = null;
        }, 500);
      }

      // this._didFirstRun = true;
    }, 500);
  }

  _queryDisplay() {
    let idx = this.preferred_monitor || 0;
    if (idx == 0) {
      idx = Main.layoutManager.primaryIndex;
    } else if (idx == Main.layoutManager.primaryIndex) {
      idx = 0;
    }
    this.monitor =
      Main.layoutManager.monitors[idx] || Main.layoutManager.primaryMonitor;

    if (this.dashContainer) {
      this.dashContainer._monitor = this.monitor;
    }
    this.sw = this.monitor.width;
    this.sh = this.monitor.height;

    if (this._last_monitor_count != Main.layoutManager.monitors.length) {
      // save monitor count - for preference pages (todo dbus?)
      // let tmp = Gio.File.new_for_path(
      //   `${GLib.get_tmp_dir()}/monitors.dash2dock-lite`
      // );
      // let content = `${Main.layoutManager.monitors.length}\n`;
      // const [, etag] = tmp.replace_contents(
      //   content,
      //   null,
      //   false,
      //   Gio.FileCreateFlags.REPLACE_DESTINATION,
      //   null
      // );
      this._settings.set_int(
        'monitor-count',
        Main.layoutManager.monitors.length
      );
      this._last_monitor_count = Main.layoutManager.monitors.length;
    }
  }

  _enableSettings() {
    this._settings = ExtensionUtils.getSettings(schemaId);
    this._settingsKeys = SettingsKeys;

    SettingsKeys.connectSettings(this._settings, (name, value) => {
      let n = name.replace(/-/g, '_');
      this[n] = value;

      // log(`${n} ${value}`);

      switch (name) {
        case 'msg-to-ext': {
          if (value.length) {
            try {
              eval(value);
            } catch (err) {
              log(err);
            }
            this._settings.set_string('msg-to-ext', '');
          }
          break;
        }
        case 'animation-fps':
        case 'mounted-icon':
        case 'peek-hidden-icons': {
          break;
        }
        case 'animation-magnify':
        case 'animation-spread':
        case 'animation-rise': {
          if (this.animate_icons) {
            this.animator.preview();
            this.animator._onEnterEvent();
          }
          break;
        }
        case 'notification-badge-color':
        case 'notification-badge-style':
        case 'running-indicator-color':
        case 'running-indicator-style':
          this._onEnterEvent();
          break;
        case 'apps-icon':
        case 'calendar-icon':
        case 'clock-icon': {
          this._onEnterEvent();
          break;
        }
        case 'icon-effect': {
          if (this.animate_icons) {
            this.animator.disable();
            this.animator.enable();
            this._updateLayout();
            this._onEnterEvent();
          }
          break;
        }
        case 'icon-effect-color': {
          if (this.animate_icons && this.animator.iconEffect) {
            this.animator.iconEffect.color = this.icon_effect_color;
            this._onEnterEvent();
          }
          break;
        }
        case 'animate-icons': {
          this._updateAnimation();
          break;
        }
        case 'dock-location': {
          this._updateLayout();
          this._onEnterEvent();
          break;
        }
        case 'preferred-monitor': {
          // todo!
          // this.disable();
          // this.enable();
          this._updateLayout();
          this._onEnterEvent();
          break;
        }
        case 'autohide-dash': {
          this._updateAutohide();
          break;
        }
        case 'shrink-icons': {
          this._updateShrink();
          this._onEnterEvent();
          break;
        }
        case 'scale-icons': {
          this._debounceUpdateScale();
          break;
        }
        case 'panel-mode': {
          this._updateCss();
          this._updateBackgroundColors();
          this._updateLayout();
          this._onEnterEvent();
          break;
        }
        case 'topbar-background-color':
        case 'background-color': {
          this._updateBackgroundColors();
          break;
        }
        case 'pressure-sense': {
          break;
        }
        case 'border-radius': {
          this._updateCss();
          break;
        }
        case 'trash-icon': {
          this._updateTrashIcon();
          this._updateLayout();
          this._onEnterEvent();
          this._timeoutId = setTimeout(() => {
            this._updateLayout();
            this._onEnterEvent();
            this._timeoutId = null;
          }, 250);
          break;
        }
      }
    });

    Object.keys(SettingsKeys._keys).forEach((k) => {
      let key = SettingsKeys.getKey(k);
      let name = k.replace(/-/g, '_');
      this[name] = key.value;
    });
  }

  _disableSettings() {
    SettingsKeys.disconnectSettings();
  }

  _addEvents() {
    this.dashContainer.set_reactive(true);
    this.dashContainer.set_track_hover(true);
    this.dashContainer.connectObject(
      'motion-event',
      this._onMotionEvent.bind(this),
      'enter-event',
      this._onEnterEvent.bind(this),
      'leave-event',
      this._onLeaveEvent.bind(this),
      'destroy',
      () => {},
      this
    );

    Main.sessionMode.connectObject(
      'updated',
      () => this._onSessionUpdated(),
      this
    );
    Main.layoutManager.connectObject(
      'startup-complete',
      this.startUp.bind(this),
      'monitors-changed',
      () => {
        this._updateLayout();
        this._onEnterEvent();
      },
      this
    );

    Main.messageTray.connectObject(
      'queue-changed',
      (count) => {
        this.services.checkNotifications();
      },
      this
    );

    global.display.connectObject(
      // 'window-demands-attention',
      // () => { log('window-demands-attention') },
      // 'window-marked-urgent',
      // () => { log('window-marked-urgent') },
      'notify::focus-window',
      this._onFocusWindow.bind(this),
      'in-fullscreen-changed',
      this._onFullScreen.bind(this),
      this
    );

    Main.overview.connectObject(
      'showing',
      this._onOverviewShowing.bind(this),
      this
    );
    Main.overview.connectObject(
      'hidden',
      this._onOverviewHidden.bind(this),
      this
    );

    St.TextureCache.get_default().connectObject(
      'icon-theme-changed',
      this._onIconThemeChanged.bind(this),
      this
    );

    this._intervals = [];
    this._intervals.push(
      setInterval(this._onCheckServices.bind(this), SERVICES_UPDATE_INTERVAL)
    );
  }

  _removeEvents() {
    if (this._timeoutId) {
      clearInterval(this._timeoutId);
      this._timeoutId = null;
    }
    if (this.oneShotStartupCompleteId) {
      clearInterval(this.oneShotStartupCompleteId);
      this.oneShotStartupCompleteId = null;
    }
    if (this._intervals) {
      this._intervals.forEach((id) => {
        clearInterval(id);
      });
      this._intervals = [];
    }

    this.dashContainer.set_reactive(false);
    this.dashContainer.set_track_hover(false);
    this.dashContainer.disconnectObject(this);
    Main.sessionMode.disconnectObject(this);
    Main.messageTray.disconnectObject(this);
    Main.overview.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);
    global.display.disconnectObject(this);
    St.TextureCache.get_default().disconnectObject(this);
  }

  _onIconThemeChanged() {
    if (this.animate_icons) {
      this.services.disable();
      this.services.enable();
    }
    this.animator.disable();
    this.animator.enable();
    this._onEnterEvent();
  }

  _onMotionEvent() {
    this.listeners
      .filter((l) => {
        return l._enabled;
      })
      .forEach((l) => {
        if (l._onMotionEvent) l._onMotionEvent();
      });
  }

  _onEnterEvent() {
    this.listeners
      .filter((l) => {
        return l._enabled;
      })
      .forEach((l) => {
        if (l._onEnterEvent) l._onEnterEvent();
      });

    this._updateLayout();
  }

  _onLeaveEvent() {
    this.listeners
      .filter((l) => {
        return l._enabled;
      })
      .forEach((l) => {
        if (l._onLeaveEvent) l._onLeaveEvent();
      });
  }

  _onFocusWindow() {
    this.listeners
      .filter((l) => {
        return l._enabled;
      })
      .forEach((l) => {
        if (l._onFocusWindow) l._onFocusWindow();
      });

    this._onCheckServices();
  }

  _onFullScreen() {
    this.listeners
      .filter((l) => {
        return l._enabled;
      })
      .forEach((l) => {
        if (l._onFullScreen) l._onFullScreen();
      });
  }

  _updateScale() {
    this._updateShrink();
    this._timeoutId = null;
  }

  _debounceUpdateScale() {
    if (this._timeoutId) {
      clearInterval(this._timeoutId);
    }
    this._timeoutId = setTimeout(this._updateScale.bind(this), 250);
  }

  _updateShrink(disable) {
    if (!this.dashContainer) return;

    let rescale_modifier = 0.8 + 1.4 * this.scale_icons;
    if (this.scale_icons == 0) {
      rescale_modifier = 1;
    }
    if (this.shrink_icons && !disable) {
      this.scale = 0.8 * rescale_modifier;
      this.dashContainer.add_style_class_name('shrink');
    } else {
      this.scale = 1.0 * rescale_modifier;
      this.dashContainer.remove_style_class_name('shrink');
    }

    this._updateLayout();

    if (this.animate_icons) {
      this.animator.disable();
      this.animator.enable();
    }
  }

  _updateBackgroundColors(disable) {
    if (!this.dash) return;

    this._backgroundEffect.color = this.background_color || [0, 0, 0, 0.5];
    this._backgroundEffect.blend = this.background_color[3] || 0.5;

    if (disable) {
      Main.panel.background_color = Clutter.Color.from_pixel(0xffffff00);
    } else {
      let bg = Clutter.Color.from_pixel(0xffffffff);
      bg.red = Math.floor(this.topbar_background_color[0] * 255);
      bg.green = Math.floor(this.topbar_background_color[1] * 255);
      bg.blue = Math.floor(this.topbar_background_color[2] * 255);
      bg.alpha = Math.floor(this.topbar_background_color[3] * 255);
      Main.panel.background_color = bg;
    }

    let background = this.dash._background || null;
    if (background) {
      if (this.panel_mode && !disable) {
        let bg = Clutter.Color.from_pixel(0xffffffff);
        bg.red = Math.floor(this.background_color[0] * 255);
        bg.green = Math.floor(this.background_color[1] * 255);
        bg.blue = Math.floor(this.background_color[2] * 255);
        bg.alpha = Math.floor(this.background_color[3] * 255);
        let clr = Clutter.Color.from_pixel(
          this.background_dark ? 0x00000050 : 0x50505050
        );
        clr.alpha = this.background_opacity * 255;
        this.dash.background_color = bg;
        background.visible = false;
      } else {
        this.dash.background_color = Clutter.Color.from_pixel(0x00000000);
        background.visible = true;
      }
    }

    this._updateCss(disable);
  }

  _updateCss(disable) {
    if (!this.dash || !this.dashContainer) return;

    let background = this.dash._background || null;
    if (background && this.border_radius !== null) {
      let r = -1;
      if (!disable && !this.panel_mode) {
        r = Math.floor(this.border_radius);
        this.dash.add_style_class_name(`border-radius-${r}`);
      }
      for (let i = 0; i < 7; i++) {
        if (i != r) {
          this.dash.remove_style_class_name(`border-radius-${i}`);
        }
      }
    }

    if (!disable && this.animate_icons) {
      this.dash.add_style_class_name('custom-dots');
    } else {
      this.dash.remove_style_class_name('custom-dots');
    }
  }

  _findIcons() {
    if (!this.dash) return [];

    if (this.dash._showAppsIcon) {
      this.dash._showAppsIcon.visible = this.apps_icon;
    }

    // hook on showApps
    if (this.dash.showAppsButton && !this.dash.showAppsButton._checkEventId) {
      this.dash.showAppsButton._checkEventId = this.dash.showAppsButton.connect(
        'notify::checked',
        () => {
          if (!Main.overview.visible) {
            Main.uiGroup
              .find_child_by_name('overview')
              ._controls._toggleAppsPage();
          }
        }
      );
    }

    // W: breakable
    let icons = this.dash._box.get_children().filter((actor) => {
      if (actor.child && actor.child._delegate && actor.child._delegate.icon) {
        return true;
      }
      return false;
    });

    icons.forEach((c) => {
      // W: breakable
      let label = c.label;
      let appwell = c.first_child;
      let draggable = appwell._draggable;
      let widget = appwell.first_child;
      let icongrid = widget.first_child;
      let boxlayout = icongrid.first_child;
      let bin = boxlayout.first_child;
      let icon = bin.first_child;

      c._bin = bin;
      c._label = label;
      c._draggable = draggable;
      c._appwell = appwell;
      if (icon) {
        c._icon = icon;
      }
    });

    try {
      // W: breakable
      let apps = this.dash._showAppsIcon;
      //  this.dash.last_child.last_child;
      if (apps) {
        let widget = apps.child;
        if (widget && widget.width > 0 && widget.get_parent().visible) {
          let icongrid = widget.first_child;
          let boxlayout = icongrid.first_child;
          let bin = boxlayout.first_child;
          let icon = bin.first_child;
          let c = {};
          c.child = widget;
          c._bin = bin;
          c._icon = icon;
          c._label = widget._delegate.label;
          icons.push(c);
        }
      }
    } catch (err) {
      // could happen if ShowApps is hidden or not yet created?
    }

    this.dashContainer._icons = icons;
    return icons;
  }

  _updateLayout(disable) {
    if (disable || !this.dashContainer) return;

    this._queryDisplay();

    let pos = this.dock_location || 0;
    // See St position constants
    // remap [ bottom, left, right, top ] >> [ top, right, bottom, left ]
    this.dashContainer._position = [2, 3, 1, 0][pos];
    this._vertical =
      this.dashContainer._position == 1 || this.dashContainer._position == 3;

    this.scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    let iconSize = 64;

    let scale = this.scale;
    let dockHeight = iconSize * (this.shrink_icons ? 1.8 : 1.6) * scale;

    // panel mode adjustment
    if (this.panel_mode) {
      dockHeight -= 10 * this.scaleFactor;
    }

    if (this._vertical) {
      // left/right
      this.dashContainer.set_size(dockHeight * this.scaleFactor, this.sh);
      this.dash.last_child.layout_manager.orientation = 1;
      this.dash._box.layout_manager.orientation = 1;
      this.dash._box.height = -1;
      this.dash._box.width = dockHeight * this.scaleFactor;

      this.dash.add_style_class_name('vertical');
    } else {
      // top/bottom
      this.dashContainer.set_size(this.sw, dockHeight * this.scaleFactor);
      this.dash.last_child.layout_manager.orientation = 0;
      this.dash._box.layout_manager.orientation = 0;
      this.dash._box.height = -1;
      this.dash._box.width = -1;

      this.dash.remove_style_class_name('vertical');
    }

    if (this.autohider._enabled && !this.autohider._shown) {
      // remain hidden
    } else {
      if (this._vertical) {
        // left/right
        this.dashContainer.set_position(this.monitor.x, this.monitor.y);
      } else {
        // top/bottom
        this.dashContainer.set_position(
          this.monitor.x,
          this.monitor.y + this.sh - dockHeight * this.scaleFactor
        );
      }

      this.dashContainer._fixedPosition = this.animator._get_position(
        this.dashContainer
      );
      this.dashContainer._dockHeight = dockHeight * this.scaleFactor;
    }

    let iconChildren = this._findIcons();

    let iconHook = [...iconChildren];
    for (let i = 0; i < iconHook.length; i++) {
      if (!iconHook[i].child) continue;
      // W: breakable
      let icon = iconHook[i].child._delegate.icon;
      if (!icon._setIconSize) {
        icon._setIconSize = icon.setIconSize;
      }

      icon._scale = scale;
      icon.setIconSize = ((sz) => {
        sz *= icon._scale;
        icon._setIconSize(sz);
      }).bind(icon);
    }

    this.dash._maxWidth = this.sw;
    this.dash._maxHeight = this.sh;
    this.dash.iconSize--;
    this.dash._adjustIconSize();
  }

  _updateAnimation(disable) {
    if (this.animate_icons && !disable) {
      this.animator.enable();
    } else {
      this.animator.disable();
    }
    this._updateCss();
  }

  _updateAutohide(disable) {
    this.autohider.animator = this.animator;
    this.dashContainer.autohider = this.autohider;

    if (this.autohide_dash && !disable) {
      this.autohider.enable();
    } else {
      this.autohider.disable();
    }

    if (this.animate_icons) {
      this.animator.disable();
    }

    Main.layoutManager.removeChrome(this.dashContainer);
    Main.layoutManager.addChrome(this.dashContainer, {
      affectsStruts: !this.autohide_dash,
      trackFullscreen: true,
    });

    if (this.animator._iconsContainer) {
      Main.uiGroup.remove_child(this.animator._dotsContainer);
      Main.uiGroup.remove_child(this.animator._iconsContainer);
      Main.uiGroup.insert_child_above(
        this.animator._dotsContainer,
        this.dashContainer
      );
      Main.uiGroup.insert_child_below(
        this.animator._iconsContainer,
        this.animator._dotsContainer
      );
    }

    if (this.animate_icons) {
      this.animator.enable();
    }
  }

  _updateTrashIcon() {
    this.services.updateTrashIcon(this.trash_icon);
  }

  _onOverviewShowing() {
    this._inOverview = true;

    if (this.reuseExistingDash) {
      this.dashContainer.remove_child(this.dash);
      Main.uiGroup
        .find_child_by_name('overview')
        .first_child.add_child(this.dash);
    }

    this.dashContainer.hide();
    if (this.animator && this.animate_icons) {
      this.animator._beginAnimation();
      if (this.animator._iconsContainer) {
        this.animator._iconsContainer.hide();
        this.animator._dotsContainer.hide();
      }
    }
    // this._onEnterEvent();
    // log('_onOverviewShowing');
  }

  _onOverviewHidden() {
    this._inOverview = false;

    if (this.reuseExistingDash) {
      Main.uiGroup
        .find_child_by_name('overview')
        .first_child.remove_child(this.dash);
      this.dashContainer.add_child(this.dash);
    }

    this.dashContainer.show();
    this._onEnterEvent();

    // log('_onOverviewHidden');
  }

  _onSessionUpdated() {
    this._updateLayout();
    this.autohider._debounceCheckHide();
  }

  _onCheckServices() {
    if (!this.services) return; // todo why does this happen?
    this.services.update(SERVICES_UPDATE_INTERVAL);
    this._updateTrashIcon();
  }

  runDiagnostics() {
    runTests(this, SettingsKeys);
  }
}

function init() {
  return new Extension();
}
