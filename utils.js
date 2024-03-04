import GLib from 'gi://GLib';

// todo.. recompute ... seems to length the debounce hold out period
const DEBOUNCE_PRECISION = 1;

const dummy_pointer = {
  get_position: () => {
    return [{}, 0, 0];
  },
  warp: (screen, x, y) => {},
};

// TODO: Gnome 45? how to move mouse
// var getPointer = () => {
//   let display = Gdk.Display.get_default();

//   // wayland?
//   if (!display) {
//     return dummy_pointer;
//   }

//   let deviceManager = display.get_device_manager();
//   if (!deviceManager) {
//     return dummy_pointer;
//   }
//   let pointer = deviceManager.get_client_pointer() || dummy_pointer;
//   return pointer;
// };

export const getPointer = () => {
  return global.get_pointer();
};

export const warpPointer = (pointer, x, y) => {
  let [screen, pointerX, pointerY] = pointer.get_position();
  pointer.warp(screen, x, y);
};

export const setTimeout = (func, delay, ...args) => {
  const wrappedFunc = () => {
    func.apply(this, args);
  };
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, wrappedFunc);
};

export const setInterval = (func, delay, ...args) => {
  const wrappedFunc = () => {
    return func.apply(this, args) || true;
  };
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, wrappedFunc);
};

export const clearTimeout = (id) => {
  GLib.source_remove(id);
};

export const clearInterval = (id) => {
  GLib.source_remove(id);
};
