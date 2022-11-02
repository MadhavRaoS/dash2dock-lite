var Animation = (animateIcons, pointer, container, settings) => {
  let dash = container.dash;
  let [px, py] = pointer;
  let first = animateIcons[0]._pos || [0, 0];
  let second = animateIcons[1]._pos || [0, 0];
  let last = animateIcons[animateIcons.length - 1]._pos || [0, 0];
  let nsz = second[0] - first[0];

  let sz = nsz * (4 + 2 * settings.animation_spread);
  let szr = sz / 2;
  let center = [px, first[1]];

  // spread
  let pad =
    settings.iconSize *
    4 *
    settings.scaleFactor *
    (settings.animation_spread / 2);
  container._targetScale = (dash.width + pad) / dash.width;

  // compute diameter
  animateIcons.forEach((i) => {
    i._d = nsz;

    // distance
    let dx = i._pos[0] - center[0];
    // let dy = i._pos[1] - center[1];
    let dst = dx * dx; // Math.sqrt(dx * dx + dy * dy);
    if (dst < szr * szr) {
      let dd = 1.0 - Math.abs(dx) / szr;
      i._d = nsz + nsz * settings.animation_magnify * settings.scaleFactor * dd;
    }
    i._pos2 = [...i._pos];
    i._targetScale = i._d / nsz;

    // rise
    i._pos2[1] -= (i._d - nsz) * settings.animation_rise;
  });

  // collide
  let dd = 0;
  for (let idx = 0; idx < animateIcons.length - 1; idx++) {
    let a = animateIcons[idx];
    let b = animateIcons[idx + 1];
    let dx = b._pos2[0] - a._pos2[0];
    let dst = a._d / 2 + b._d / 2;
    if (dx < dst) {
      dd += a._pos2[0] + dst - b._pos2[0];
      b._pos2[0] = a._pos2[0] + dst;
    }
  }

  let w1 = last[0] - first[0];
  let w2 =
    animateIcons[animateIcons.length - 1]._pos2[0] - animateIcons[0]._pos2[0];
  animateIcons.forEach((i) => {
    // let x1 = i._pos[0] - first._pos[0];
    let p = (i._pos2[0] - first[0]) / w2;
    let x = p * w1;
    i._pos2[0] = first[0] + x;
  });
  animateIcons.forEach((i) => {
    i._pos = i._pos2;
  });

  let debugDraw = [];
  debugDraw = animateIcons.map((i) => ({
    t: 'circle',
    x: i._pos[0],
    y: i._pos[1],
    d: i._d,
    c: [1, 0, 0, 1],
  }));

  // debugDraw = debugDraw.splice(0,2);

  debugDraw.push({
    t: 'circle',
    x: center[0],
    y: center[1],
    d: sz,
    c: [1, 1, 0, 1],
  });

  // debugDraw.push({
  //   t: 'line',
  //   x: first[0],
  //   y: first[1],
  //   x2: last[1],
  //   y2: last[1],
  //   c: [1, 0, 1, 1],
  // });

  return {
    first,
    last,
    debugDraw,
  };
};