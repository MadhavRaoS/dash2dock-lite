/*
  License: GPL v3
*/

const Main = imports.ui.main;
const Dash = imports.ui.dash.Dash;
const Layout = imports.ui.layout;
const Shell = imports.gi.Shell;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Point = imports.gi.Graphene.Point;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const setTimeout = Me.imports.utils.setTimeout;
const setInterval = Me.imports.utils.setInterval;
const clearInterval = Me.imports.utils.clearInterval;
const clearTimeout = Me.imports.utils.clearTimeout;

const ANIMATION_INTERVAL = 25;
const ANIMATION_POS_COEF = 2;
const ANIMATION_PULL_COEF = 1.5;
const ANIMATION_SCALE_COEF = 2.5;
const ANIM_ICON_RAISE = 0.15;
const ANIM_ICON_SCALE = 2.0;

var Animator = class {
  constructor() {}

  enable() {
    this._iconsContainer = new St.Widget({ name: 'iconsContainer' });
    Main.uiGroup.add_child(this._iconsContainer);
    // this._iconsContainer.hide();

    this._hookDashContainer();
    log('enable animator');

    this._enabled = true;
  }

  disable() {
    this._enabled = false;

    this._endAnimation();

    if (this._iconsContainer) {
      Main.uiGroup.remove_child(this._iconsContainer);
      delete this._iconsContainer;
      this._iconsContainer = null;
    }

    if (this.dashContainer) {
      this._restoreIcons();
      // if (this.dashContainer.__animateIn) {
      //   this.dashContainer._animateIn = this.dashContainer.__animateIn;
      //   this.dashContainer.__animateIn = null;
      // }
      // if (this.dashContainer.__animateOut) {
      //   this.dashContainer._animateOut = this.dashContainer.__animateOut;
      //   this.dashContainer.__animateOut = null;
      // }
      this.dashContainer = null;
    }

    log('disable animator');
  }

  _hookDashContainer() {
    if (this.dashContainer) {
      return false;
    }

    // hooks
    // this.dashContainer.__animateIn = this.dashContainer._animateIn;
    // this.dashContainer.__animateOut = this.dashContainer._animateOut;
    // this.dashContainer._animateIn = (time, delay) => {
    //   this._startAnimation();
    //   this.dashContainer.__animateIn(time, delay);
    // };
    // this.dashContainer._animateOut = (time, delay) => {
    //   this._startAnimation();
    //   this.dashContainer.__animateOut(time, delay);
    // };

    return true;
  }

  _animate() {
    if (!this._enabled || !this._iconsContainer || !this.dashContainer) return;
    this.dash = this.dashContainer.dash;

    let existingIcons = this._iconsContainer.get_children();

    // if (!this._iconsContainer.visible) {
    //   // dashtodock!
    //   if (this.dashContainer._dockState > 0) {
    //     this._iconsContainer.show();
    //   }
    //   return;
    // }

    let dock_position = 'bottom';
    let ix = 0;
    let iy = 1;

    let pivot = new Point();
    pivot.x = 0.5;
    pivot.y = 1.0;

    // dashtodock!
    this.dashContainer._position = 2;

    switch (this.dashContainer._position) {
      case 1:
        dock_position = 'right';
        ix = 1;
        iy = 0;
        pivot.x = 1.0;
        pivot.y = 0.5;
        break;
      case 2:
        dock_position = 'bottom';
        break;
      case 3:
        dock_position = 'left';
        ix = 1;
        iy = 0;
        pivot.x = 0.0;
        pivot.y = 0.5;
        break;
    }

    let icons = this._findIcons();
    icons.forEach((c) => {
      let bin = c._bin;
      if (!bin) return;

      for (let i = 0; i < existingIcons.length; i++) {
        if (existingIcons[i]._bin == bin) {
          return;
        }
      }

      let icon = c._icon;

      let uiIcon = new St.Icon({ name: 'some_icon' });
      if (icon.icon_name) {
        uiIcon.icon_name = icon.icon_name;
      } else if (icon.gicon) {
        uiIcon.gicon = icon.gicon;
      }
      uiIcon.pivot_point = pivot;
      uiIcon._bin = bin;
      uiIcon._label = c._label;

      this._iconsContainer.add_child(uiIcon);

      // spy dragging events
      let draggable = bin._draggable;
      if (draggable && !draggable._dragBeginId) {
        draggable._dragBeginId = draggable.connect('drag-begin', () => {
          this._dragging = true;
          this.disable();
        });
        draggable._dragEndId = draggable.connect('drag-end', () => {
          this._dragging = false;
          this.disable();
          this.enable();
        });
      }
    });

    let pointer = global.get_pointer();

    let nearestIdx = -1;
    let nearestIcon = null;
    let nearestDistance = -1;
    let iconSize = this.dash.iconSize;

    let animateIcons = this._iconsContainer.get_children();
    animateIcons.forEach((c) => {
      let orphan = true;
      for (let i = 0; i < icons.length; i++) {
        if (icons[i]._bin == c._bin) {
          orphan = false;
          break;
        }
      }

      if (orphan) {
        this._iconsContainer.remove_child(c);
        return;
      }
    });

    animateIcons = [...this._iconsContainer.get_children()];

    // sort
    let cornerPos = this._get_position(this.dashContainer);
    animateIcons.sort((a, b) => {
      let dstA = this._get_distance(cornerPos, this._get_position(a));
      let dstB = this._get_distance(cornerPos, this._get_position(b));
      return dstA > dstB ? 1 : -1;
    });

    let idx = 0;
    animateIcons.forEach((icon) => {
      let bin = icon._bin;
      let pos = this._get_position(bin);

      iconSize = this.dash.iconSize * this.dashContainer.delegate.scale;
      bin.set_size(iconSize, iconSize);
      icon.set_size(iconSize, iconSize);

      // get nearest
      let bposcenter = [...pos];
      bposcenter[0] += bin.first_child.size.width / 2;
      bposcenter[1] += bin.first_child.size.height / 2;
      let dst = this._get_distance(pointer, bposcenter);

      if (
        (nearestDistance == -1 || nearestDistance > dst) &&
        dst < iconSize * 0.8
      ) {
        nearestDistance = dst;
        nearestIcon = icon;
        nearestIdx = idx;
        icon._distance = dst;
        icon._dx = bposcenter[0] - pointer[0];
        icon._dy = bposcenter[1] - pointer[1];
      }

      if (bin._apps) {
        bin.first_child.add_style_class_name('invisible');
      } else {
        bin.first_child.hide();
      }

      icon._target = pos;
      icon._targetScale = 1;

      idx++;
    });

    // set animation behavior here
    if (nearestIcon && nearestDistance < iconSize * 2) {
      nearestIcon._target[iy] -= iconSize * ANIM_ICON_RAISE;
      nearestIcon._targetScale = ANIM_ICON_SCALE;

      let offset = nearestIcon._dx / 4;
      let offsetY = (offset < 0 ? -offset : offset) / 2;
      nearestIcon._target[ix] += offset;
      nearestIcon._target[iy] += offsetY;

      let prevLeft = nearestIcon;
      let prevRight = nearestIcon;
      let sz = nearestIcon._targetScale;
      let pull_coef = ANIMATION_PULL_COEF;

      for (let i = 1; i < 80; i++) {
        sz *= 0.8;

        let left = null;
        let right = null;
        if (nearestIdx - i >= 0) {
          left = animateIcons[nearestIdx - i];
          left._target[ix] =
            (left._target[ix] + prevLeft._target[ix] * pull_coef) /
            (pull_coef + 1);
          left._target[ix] -= iconSize * (sz + 0.2);
          if (sz > 1) {
            left._targetScale = sz;
          }
          prevLeft = left;
        }
        if (nearestIdx + i < animateIcons.length) {
          right = animateIcons[nearestIdx + i];
          right._target[ix] =
            (right._target[ix] + prevRight._target[ix] * pull_coef) /
            (pull_coef + 1);
          right._target[ix] += iconSize * (sz + 0.2);
          if (sz > 1) {
            right._targetScale = sz;
          }
          prevRight = right;
        }

        if (!left && !right) break;

        pull_coef *= 0.9;
      }
    }

    let didAnimate = false;

    // animate to target scale and position
    animateIcons.forEach((icon) => {
      let pos = icon._target;
      let scale = icon._targetScale;
      let fromScale = icon.get_scale()[0];

      icon.set_scale(1, 1);
      let from = this._get_position(icon);
      let dst = this._get_distance(from, icon._target);

      scale =
        (fromScale * ANIMATION_SCALE_COEF + scale) / (ANIMATION_SCALE_COEF + 1);

      if (dst > iconSize * 0.01 && dst < iconSize * 3) {
        pos[0] =
          (from[0] * ANIMATION_POS_COEF + pos[0]) / (ANIMATION_POS_COEF + 1);
        pos[1] =
          (from[1] * ANIMATION_POS_COEF + pos[1]) / (ANIMATION_POS_COEF + 1);
        didAnimate = true;
      }

      if (!isNaN(scale)) {
        icon.set_scale(scale, scale);
      }

      if (!isNaN(pos[0]) && !isNaN(pos[1])) {
        // why does NaN happen?
        icon.set_position(pos[0], pos[1]);

        switch (dock_position) {
          case 'left':
            icon._label.x = pos[0] + iconSize * scale * 0.75;
            break;
          case 'right':
            icon._label.x = pos[0] - iconSize * scale * 0.75;
            icon._label.x -= icon._label.width / 1.8;
            break;
          case 'bottom':
            icon._label.y = pos[1] - iconSize * scale * 0.75;
            break;
        }
      }
    });

    if (didAnimate) {
      this._debounceEndAnimation();
    }
  }

  _findIcons() {
    return this.dashContainer.delegate._findIcons();
  }

  _restoreIcons() {
    let icons = this._findIcons();
    icons.forEach((c) => {
      c._icon.show();
      c._icon.remove_style_class_name('invisible');
    });
  }

  _get_x(obj) {
    if (obj == null) return 0;
    return obj.get_transformed_position()[0];
  }

  _get_y(obj) {
    if (obj == null) return 0;
    return obj.get_transformed_position()[1];
  }

  _get_position(obj) {
    return [this._get_x(obj), this._get_y(obj)];
  }

  _get_distance_sqr(pos1, pos2) {
    let a = pos1[0] - pos2[0];
    let b = pos1[1] - pos2[1];
    return a * a + b * b;
  }

  _get_distance(pos1, pos2) {
    return Math.sqrt(this._get_distance_sqr(pos1, pos2));
  }

  _beginAnimation() {
    if (this._timeoutId) {
      clearInterval(this._timeoutId);
      this._timeoutId = null;
    }
    if (this._intervalId == null) {
      this._intervalId = setInterval(
        this._animate.bind(this),
        ANIMATION_INTERVAL
      );
    }

    if (this.dashContainer) {
      this.dashContainer.add_style_class_name('hi');
    }
  }

  _endAnimation() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._timeoutId = null;

    if (this.dashContainer) {
      this.dashContainer.remove_style_class_name('hi');
    }
  }

  _debounceEndAnimation() {
    if (this._timeoutId) {
      clearInterval(this._timeoutId);
    }
    this._timeoutId = setTimeout(this._endAnimation.bind(this), 1500);
  }

  _onMotionEvent() {
    this._onEnterEvent();
  }

  _onEnterEvent() {
    this._inDash = true;
    this._startAnimation();
  }

  _onLeaveEvent() {
    this._inDash = false;
    this._debounceEndAnimation();
  }

  _onFocusWindow() {
    this._startAnimation();
  }

  _onFullScreen() {
    if (!this.dashContainer || !this._iconsContainer) return;
    let primary = Main.layoutManager.primaryMonitor;
    if (!primary.inFullscreen) {
      this._iconsContainer.show();
    } else {
      this._iconsContainer.hide();
    }
  }

  _startAnimation() {
    this._beginAnimation();
    this._debounceEndAnimation();
  }
};