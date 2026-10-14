// src/rpg.js
import * as THREE7 from "three";

// src/mechanics.js
import * as THREE5 from "three";

// src/resources/physics/physicsSetup.js
import RAPIER from "https://esm.sh/@dimforge/rapier3d-compat@0.20.0";
async function setupPhysics(config = {}) {
  await RAPIER.init();
  const gravity = config.gravity ?? config.PHYSICS?.GRAVITY ?? { x: 0, y: -9.81, z: 0 };
  const world = new RAPIER.World(gravity);
  const eventQueue = new RAPIER.EventQueue(true);
  const bodyFactoryRegistry = /* @__PURE__ */ new Map();
  let disposed = false;
  const physicsResource = {
    RAPIER,
    // Expose the RAPIER library for advanced use in game factories
    world,
    eventQueue,
    // Expose the event queue
    bodyFactoryRegistry,
    registerBodyFactory: (componentName, factory) => {
      bodyFactoryRegistry.set(componentName, factory);
    },
    getBodyFactory: (componentName) => {
      return bodyFactoryRegistry.get(componentName);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      bodyFactoryRegistry.clear();
      eventQueue.free();
      world.free();
    }
  };
  return physicsResource;
}

// src/resources/inputSetup.js
var defaultKeyMappings = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "backward",
  ArrowDown: "backward",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "jump",
  ShiftLeft: "run",
  ShiftRight: "run",
  Escape: "escape"
};
async function setupInput(config = {}) {
  const eventWindow = config.inputWindow ?? globalThis.window;
  const document2 = config.inputDocument ?? config.canvas?.ownerDocument ?? globalThis.document;
  const target = config.inputTarget ?? config.canvas ?? eventWindow;
  if (!eventWindow || !target) throw new Error("Input requires a browser window and a canvas/inputTarget.");
  const keyMappings = { ...defaultKeyMappings, ...config.keyMappings };
  const keys = /* @__PURE__ */ new Set();
  const actions = /* @__PURE__ */ new Set();
  const pressedActions = /* @__PURE__ */ new Set();
  const buttons = /* @__PURE__ */ new Set();
  let mouseX = 0;
  let mouseY = 0;
  let axisX = 0, axisZ = 0;
  let disposed = false;
  const listeners = [];
  const listen = (object, type, listener) => {
    object?.addEventListener(type, listener);
    listeners.push(() => object?.removeEventListener(type, listener));
  };
  const reset = () => {
    keys.clear();
    actions.clear();
    pressedActions.clear();
    buttons.clear();
    axisX = axisZ = 0;
  };
  const editable = (element) => element?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element?.tagName ?? "");
  const focused = () => target === eventWindow || document2?.pointerLockElement === target || document2?.activeElement === target || target.contains?.(document2?.activeElement);
  const active = (action) => actions.has(action) || [...keys].some((key) => keyMappings[key] === action);
  const originalTabIndex = target.getAttribute?.("tabindex");
  if (target !== eventWindow && target.tabIndex < 0) target.tabIndex = 0;
  listen(eventWindow, "keydown", (event) => {
    if (!focused() || editable(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const action = keyMappings[event.code];
    if (action && !event.repeat && !active(action)) pressedActions.add(action);
    keys.add(event.code);
    if (keyMappings[event.code]) event.preventDefault();
  });
  listen(eventWindow, "keyup", (event) => {
    const wasDown = keys.delete(event.code);
    if (wasDown && keyMappings[event.code] && !editable(event.target)) event.preventDefault();
  });
  listen(target, "mousedown", (event) => {
    if (editable(event.target)) return;
    target.focus?.({ preventScroll: true });
    buttons.add(event.button ?? 0);
  });
  listen(eventWindow, "mouseup", (event) => buttons.delete(event.button ?? 0));
  listen(eventWindow, "mousemove", (event) => {
    if (!focused() && event.target !== target) return;
    mouseX = event.clientX;
    mouseY = event.clientY;
  });
  listen(eventWindow, "blur", reset);
  listen(target, "blur", reset);
  listen(document2, "visibilitychange", () => {
    if (document2.hidden) reset();
  });
  if (config.autoFocus !== false) target.focus?.({ preventScroll: true });
  return {
    isActionActive: active,
    consumeActionPress: (action) => pressedActions.delete(action),
    isKeyDown: (code) => keys.has(code),
    setAction(action, enabled) {
      if (disposed) return;
      if (enabled) {
        if (!active(action)) pressedActions.add(action);
        actions.add(action);
      } else actions.delete(action);
    },
    /** Analog movement in [-1, 1] (x right, z backward), added to keyboard movement. */
    setAxis(x, z) {
      if (disposed) return;
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error("Movement axis must be finite.");
      const length = Math.hypot(x, z), scale = length > 1 ? 1 / length : 1;
      axisX = x * scale;
      axisZ = z * scale;
    },
    /** How far the analog axis is pushed, 0 to 1. */
    getAxisLength: () => Math.hypot(axisX, axisZ),
    getMousePosition: () => ({ x: mouseX, y: mouseY }),
    isMouseDown: (button = 0) => buttons.has(button),
    getMovementVector: () => ({
      x: Number(active("right")) - Number(active("left")) + axisX,
      z: Number(active("backward")) - Number(active("forward")) + axisZ
    }),
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      for (const remove of listeners) remove();
      if (target !== eventWindow) {
        if (originalTabIndex == null) target.removeAttribute?.("tabindex");
        else target.setAttribute?.("tabindex", originalTabIndex);
      }
    }
  };
}

// src/firstPersonCamera.js
import * as THREE from "three";

// src/fpsInput.js
var pointerOwners = /* @__PURE__ */ new WeakMap();
var retiredCanvases = /* @__PURE__ */ new WeakSet();
var guardedDocuments = /* @__PURE__ */ new WeakSet();
function releaseRetiredLock(doc) {
  const target = doc.pointerLockElement;
  if (target && retiredCanvases.has(target) && !pointerOwners.has(target)) {
    try {
      doc.exitPointerLock?.();
    } catch {
    }
  }
}
function createPointerControls({
  canvas,
  getState,
  enter,
  pause,
  look,
  fire,
  release,
  resetInput,
  modeChanged,
  pendingChanged = () => {
  },
  doc = document,
  win = window,
  timeoutMs = 700,
  lockPointer = true
}) {
  const owner = {};
  pointerOwners.set(canvas, owner);
  retiredCanvases.delete(canvas);
  if (!guardedDocuments.has(doc)) {
    guardedDocuments.add(doc);
    doc.addEventListener("pointerlockchange", () => releaseRetiredLock(doc));
  }
  let disposed = false, mode = "free", pending = false, wantsLock = false, epoch = 0, timer;
  let lastX = null, lastY = null, edgeX = 0;
  const removers = [];
  const listen = (target, name, handler) => {
    target.addEventListener(name, handler);
    removers.push(() => target.removeEventListener(name, handler));
  };
  const locked = () => doc.pointerLockElement === canvas;
  const clearPending = () => {
    clearTimeout(timer);
    timer = void 0;
    pending = false;
    pendingChanged(false);
  };
  const clearInput = () => {
    lastX = lastY = null;
    edgeX = 0;
    resetInput();
  };
  function setMode(next) {
    if (mode !== next) clearInput();
    mode = next;
    modeChanged(mode);
  }
  function activate(next, token) {
    if (token !== epoch || !wantsLock) return;
    const wasPending = pending;
    clearPending();
    setMode(next);
    if (wasPending) {
      clearInput();
      enter(next);
    }
    if (next === "free" && lockPointer && canvas.style) canvas.style.cursor = "default";
  }
  function retryLock() {
    if (!lockPointer || mode !== "free" || locked() || typeof canvas.requestPointerLock !== "function") return;
    try {
      canvas.requestPointerLock()?.catch?.(() => {
      });
    } catch {
    }
  }
  function fallback(token) {
    if (token === epoch && pending) activate("free", token);
  }
  function cancel() {
    if (disposed) return;
    ++epoch;
    wantsLock = false;
    clearPending();
    clearInput();
    if (locked() && pointerOwners.get(canvas) === owner) {
      try {
        doc.exitPointerLock?.();
      } catch {
      }
    }
  }
  function requestPause() {
    const wasPlaying = getState() === "playing";
    cancel();
    if (wasPlaying) pause();
  }
  function start() {
    if (disposed || pending || getState() === "playing") return;
    const token = ++epoch;
    wantsLock = true;
    pending = true;
    pendingChanged(true);
    clearInput();
    if (locked()) {
      activate("locked", token);
      return;
    }
    if (!lockPointer || typeof canvas.requestPointerLock !== "function") {
      fallback(token);
      return;
    }
    timer = setTimeout(() => fallback(token), timeoutMs);
    try {
      const result = canvas.requestPointerLock();
      if (locked()) activate("locked", token);
      if (result?.then) result.then(() => {
        if (token === epoch && locked()) activate("locked", token);
        else releaseRetiredLock(doc);
      }, (error) => {
        if (canvas.dataset) canvas.dataset.pointerLockFailure = `${error?.name}: ${error?.message}`;
        fallback(token);
      });
    } catch (error) {
      if (canvas.dataset) canvas.dataset.pointerLockFailure = `${error?.name}: ${error?.message}`;
      fallback(token);
    }
  }
  listen(doc, "pointerlockchange", () => {
    if (locked()) {
      if (wantsLock && (pending || getState() === "playing")) activate("locked", epoch);
      else {
        try {
          doc.exitPointerLock?.();
        } catch {
        }
      }
    } else if (mode === "locked") {
      setMode("free");
      requestPause();
    }
  });
  listen(doc, "pointerlockerror", () => fallback(epoch));
  listen(doc, "mousemove", (event) => {
    if (getState() !== "playing") return;
    if (mode === "locked" && locked()) {
      look(event.movementX || 0, event.movementY || 0);
    } else if (mode === "free" && event.target === canvas) {
      if (lastX !== null) look(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
      const rect = canvas.getBoundingClientRect();
      const band = Math.min(36, rect.width * 0.08);
      const x = event.clientX - rect.left;
      edgeX = x < band ? -(1 - x / band) : x > rect.width - band ? (x - rect.width + band) / band : 0;
      edgeX = Math.max(-1, Math.min(1, edgeX));
    }
  });
  listen(canvas, "mousedown", (event) => {
    if (getState() !== "playing") return;
    if (event.button === 0) fire(event);
    retryLock();
  });
  listen(doc, "mouseup", (event) => {
    if (event.button === 0) release();
  });
  let touchPointer = false;
  for (const name of ["pointerdown", "pointermove"]) listen(doc, name, (event) => {
    touchPointer = event.pointerType === "touch" || event.pointerType === "pen";
  });
  listen(canvas, "mouseleave", (event) => {
    if (mode !== "free" || !lockPointer || touchPointer || event.sourceCapabilities?.firesTouchEvents) return;
    if (!event.relatedTarget?.closest?.("[data-roseblox-touch]")) requestPause();
  });
  listen(doc, "pointercancel", () => {
    lastX = lastY = null;
    edgeX = 0;
    release();
  });
  listen(canvas, "contextmenu", (event) => event.preventDefault());
  listen(doc, "keydown", (event) => {
    if (event.code === "Escape") {
      event.preventDefault();
      requestPause();
    }
  });
  listen(win, "blur", requestPause);
  listen(doc, "visibilitychange", () => {
    if (doc.hidden) requestPause();
  });
  modeChanged(mode);
  return {
    start,
    cancel,
    update(dt) {
      if (getState() === "playing" && mode === "free" && edgeX) look(edgeX * 900 * Math.min(Math.max(dt, 0), 0.05), 0);
    },
    get mode() {
      return mode;
    },
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
      removers.forEach((remove) => remove());
      if (pointerOwners.get(canvas) === owner) {
        pointerOwners.delete(canvas);
        retiredCanvases.add(canvas);
      }
      releaseRetiredLock(doc);
    }
  };
}

// src/firstPersonCamera.js
var canvasOwners = /* @__PURE__ */ new WeakMap();
function firstPersonOptions(options = {}) {
  const { eyeOffset = [0, 0.55, 0], sensitivity = 23e-4, yaw = 0, pitch = 0, hideBody = true, onFire, lockPointer = true } = options;
  if (!Array.isArray(eyeOffset) || eyeOffset.length !== 3 || !eyeOffset.every(Number.isFinite)) throw new Error("First-person eyeOffset must contain three finite numbers.");
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) throw new Error("First-person sensitivity must be positive.");
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new Error("First-person yaw/pitch must be finite radians.");
  if (onFire !== void 0 && typeof onFire !== "function") throw new Error("First-person onFire must be a function.");
  return { eyeOffset: new THREE.Vector3(...eyeOffset), sensitivity, yaw, pitch, hideBody, onFire, lockPointer };
}
function createFirstPersonCamera({ entity, camera, controls, canvas, input, world, onDispose, getPosition = () => entity.transform.position }, options) {
  const document2 = canvas.ownerDocument;
  const saved = { controlsEnabled: controls.enabled, playerEnabled: entity.player?.enabled, rotationOrder: camera.rotation.order, cursor: canvas.style.cursor };
  const pitchLimit = Math.PI / 2 - 0.05;
  const clampPitch = (value) => Math.max(-pitchLimit, Math.min(pitchLimit, value));
  let yaw = options.yaw, pitch = clampPitch(options.pitch);
  let enabled = false, playing = false, disposed = false, suspended = false, hidden = null, lastUpdate = performance.now();
  const active = () => !disposed && enabled && playing;
  const syncInput = () => {
    if (entity.player) entity.player.enabled = active();
  };
  function restoreBody() {
    if (hidden) {
      hidden.mesh.visible = hidden.visible;
      hidden = null;
    }
  }
  function applyCamera() {
    camera.position.copy(getPosition()).add(options.eyeOffset);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  }
  const mouse = createPointerControls({
    canvas,
    lockPointer: options.lockPointer !== false,
    doc: document2,
    win: document2.defaultView,
    getState: () => active() ? "playing" : enabled ? "paused" : "ready",
    enter: () => {
      playing = true;
      canvas.style.cursor = "none";
      canvas.focus?.({ preventScroll: true });
      lastUpdate = performance.now();
      syncInput();
    },
    pause: () => {
      playing = false;
      canvas.style.cursor = saved.cursor;
      syncInput();
    },
    look: (dx, dy) => {
      yaw -= dx * options.sensitivity;
      pitch = clampPitch(pitch - dy * options.sensitivity);
      applyCamera();
    },
    fire: (event) => {
      if (active()) {
        applyCamera();
        options.onFire?.(event);
      }
    },
    release: () => {
    },
    resetInput: () => input.reset(),
    modeChanged: (mode) => {
      canvas.dataset.aimMode = mode;
    }
  });
  const controller = {
    entity,
    get enabled() {
      return !disposed && enabled;
    },
    get locked() {
      return !disposed && document2.pointerLockElement === canvas;
    },
    get active() {
      return active();
    },
    get error() {
      return null;
    },
    /** Host look input (touch drag, gamepad) in mouse pixels. */
    look(dx, dy) {
      if (!active()) return;
      yaw -= dx * options.sensitivity;
      pitch = clampPitch(pitch - dy * options.sensitivity);
      applyCamera();
    },
    ownsHiddenVisual(owner) {
      return !disposed && owner === entity && hidden?.mesh === owner.mesh;
    },
    start() {
      if (disposed) throw new Error("This first-person camera is disposed. Create a new controller.");
      if (!world.has(entity)) throw new Error("The first-person entity is no longer in this game.");
      suspended = false;
      if (enabled) {
        mouse.start();
        return;
      }
      yaw = options.yaw;
      pitch = clampPitch(options.pitch);
      mouse.cancel();
      enabled = true;
      playing = false;
      controller.update();
      mouse.start();
    },
    pause() {
      if (disposed) return;
      suspended = true;
      mouse.cancel();
      playing = false;
      canvas.style.cursor = saved.cursor;
      syncInput();
    },
    resume() {
      if (disposed) return;
      controller.start();
    },
    stop() {
      if (disposed) return;
      suspended = false;
      enabled = playing = false;
      mouse.cancel();
      canvas.style.cursor = saved.cursor;
      syncInput();
    },
    update() {
      if (disposed) return;
      if (!world.has(entity)) {
        controller.dispose();
        return;
      }
      const now = performance.now();
      mouse.update((now - lastUpdate) / 1e3);
      lastUpdate = now;
      syncInput();
      const mesh = entity.renderable?.mesh ?? entity.mesh;
      if (hidden?.mesh !== mesh) restoreBody();
      if (options.hideBody && mesh && !hidden) {
        hidden = { mesh, visible: mesh.visible };
        mesh.visible = false;
      }
      applyCamera();
    },
    dispose() {
      if (disposed) return;
      controller.stop();
      disposed = true;
      mouse.dispose();
      canvas.removeEventListener("click", resume);
      if (canvasOwners.get(canvas) === controller) canvasOwners.delete(canvas);
      restoreBody();
      controls.enabled = saved.controlsEnabled;
      camera.rotation.reorder(saved.rotationOrder);
      if (entity.player) entity.player.enabled = saved.playerEnabled;
      onDispose(controller);
    }
  };
  function resume() {
    if (enabled && !disposed && !playing && !suspended) mouse.start();
  }
  canvas.addEventListener("click", resume);
  canvasOwners.set(canvas, controller);
  controls.enabled = false;
  controller.update();
  return controller;
}

// src/characterMotor.js
function moveCharacter({ physics, body, collider, controller, state, velocity, jumpDown = false, jumpSpeed = 0, floors, carry }, dt) {
  if (state.grounded && jumpDown && !state.jumpHeld) state.verticalVelocity = jumpSpeed;
  else if (state.grounded && state.verticalVelocity <= 0) state.verticalVelocity = -0.5;
  else state.verticalVelocity += physics.world.gravity.y * dt;
  state.jumpHeld = jumpDown;
  const riding = !!floors?.length && state.verticalVelocity + velocity.y <= 0;
  controller.computeColliderMovement(
    collider,
    riding ? { x: velocity.x * dt + carry.x, y: carry.y, z: velocity.z * dt + carry.z } : { x: velocity.x * dt, y: (state.verticalVelocity + velocity.y) * dt, z: velocity.z * dt },
    physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    void 0,
    riding ? (c) => !floors.some((f) => f === c || f.handle === c.handle) : void 0
  );
  const delta = controller.computedMovement();
  if (state.verticalVelocity > 0) {
    for (let i = 0; i < controller.numComputedCollisions(); i++) {
      if (controller.computedCollision(i)?.normal1.y < -0.01) {
        state.verticalVelocity = 0;
        break;
      }
    }
  }
  const position = body.translation();
  body.setNextKinematicTranslation({ x: position.x + delta.x, y: position.y + delta.y, z: position.z + delta.z });
  state.grounded = riding || controller.computedGrounded();
  return riding;
}
function createCapsuleController(physics) {
  const controller = physics.world.createCharacterController(0.02);
  controller.enableAutostep(0.3, 0.2, false);
  controller.disableSnapToGround();
  controller.setApplyImpulsesToDynamicBodies(true);
  return controller;
}
function capsuleSpawnClearance(physics, fixedTimeStep) {
  return 0.02 + Math.max(0, -physics.world.gravity.y) * fixedTimeStep ** 2 + 0.01;
}

// src/arcadeVehicle.js
import * as THREE2 from "three";
var up = new THREE2.Vector3(0, 1, 0);
var approach = (value, target, amount) => value + Math.sign(target - value) * Math.min(Math.abs(target - value), amount);
function arcadeVehicleOptions(config) {
  if (config.onReset !== void 0 && typeof config.onReset !== "function") throw new Error("Vehicle onReset must be a function.");
  const values = { maxSpeed: 32, reverseSpeed: 10, acceleration: 16, braking: 28, coast: 2, steerRate: 1.8, grip: 9, driftGrip: 1.8, cameraDistance: 7, cameraHeight: 3.5, lookAhead: 4, heading: 0 };
  for (const name of Object.keys(values)) {
    values[name] = config[name] ?? values[name];
    if (!Number.isFinite(values[name]) || name !== "heading" && values[name] <= 0) throw new Error(`Invalid vehicle ${name}.`);
  }
  return values;
}
function createArcadeVehicle({ entry, config, size, input, castRay, castSegment, requireLive, release }) {
  const { body, collider, handle } = entry;
  const { canvas, camera } = config, options = arcadeVehicleOptions(config);
  const spawn = entry.position.clone(), initialHeading = options.heading;
  const forward = new THREE2.Vector3(), right = new THREE2.Vector3(), velocity = new THREE2.Vector3();
  const origin = new THREE2.Vector3(), target = new THREE2.Vector3(), eye = new THREE2.Vector3(), direction = new THREE2.Vector3();
  const quaternion = new THREE2.Quaternion();
  let enabled = false, active = false, grounded = false;
  let controls = { throttle: 0, steer: 0, brake: 0, handbrake: false };
  const listeners = [];
  const listen = (object, type, fn) => {
    object?.addEventListener(type, fn);
    listeners.push(() => object?.removeEventListener(type, fn));
  };
  const clear = () => {
    controls = { throttle: 0, steer: 0, brake: 0, handbrake: false };
    input?.reset();
  };
  const pause = () => {
    active = false;
    clear();
  };
  const basis = (q) => {
    forward.set(0, 0, -1).applyQuaternion(q);
    right.crossVectors(forward, up);
  };
  body.setEnabledRotations(false, true, false, true);
  body.enableCcd(true);
  collider.setFriction(0);
  const controller = {
    get active() {
      return active;
    },
    get enabled() {
      return enabled;
    },
    get grounded() {
      return grounded;
    },
    get speed() {
      requireLive();
      basis(body.rotation());
      return velocity.copy(body.linvel()).dot(forward);
    },
    start() {
      requireLive();
      if (!active) clear();
      enabled = active = true;
      canvas?.focus({ preventScroll: true });
    },
    stop() {
      enabled = false;
      pause();
    },
    setControls(next = {}) {
      requireLive();
      const value = {};
      for (const name of ["throttle", "steer", "brake"]) {
        const n = next[name] ?? 0;
        if (!Number.isFinite(n)) throw new Error(`Vehicle ${name} must be finite.`);
        value[name] = THREE2.MathUtils.clamp(n, name === "brake" ? 0 : -1, 1);
      }
      controls = { ...value, handbrake: Boolean(next.handbrake) };
    },
    reset(position = spawn, heading = initialHeading) {
      requireLive();
      if (!Number.isFinite(heading)) throw new Error("Vehicle heading must be finite.");
      handle.setRotation(quaternion.setFromAxisAngle(up, heading));
      handle.teleport(position);
    },
    resetMotion() {
      clear();
      grounded = false;
    },
    clear,
    step(dt) {
      basis(body.rotation());
      const p = body.translation();
      grounded = false;
      for (const x of [-0.42, 0.42]) for (const z of [-0.4, 0.4]) {
        origin.copy(p).addScaledVector(right, x * size.x).addScaledVector(forward, z * size.z);
        const hit = castRay(origin, [0, -1, 0], { maxDistance: size.y / 2 + 0.16, exclude: handle, collisionGroups: config.collisionGroups });
        if (hit && hit.normal.y > 0.45) grounded = true;
      }
      velocity.copy(body.linvel());
      let speed = velocity.dot(forward), lateral = velocity.dot(right);
      const keys = input?.getMovementVector() ?? { x: 0, z: 0 };
      const throttle = active ? THREE2.MathUtils.clamp(controls.throttle - keys.z, -1, 1) : 0;
      const steer = active ? THREE2.MathUtils.clamp(controls.steer + keys.x, -1, 1) : 0;
      const brake = active ? controls.brake : 0;
      const handbrake = active && (controls.handbrake || input?.isActionActive("handbrake"));
      let yawRate = 0;
      if (grounded) {
        if (brake || handbrake) speed = approach(speed, 0, (brake * options.braking + (handbrake ? options.braking * 0.3 : 0)) * dt);
        else if (throttle && speed * throttle < -0.25) speed = approach(speed, 0, options.braking * Math.abs(throttle) * dt);
        else if (throttle) speed = approach(speed, throttle * (throttle > 0 ? options.maxSpeed : options.reverseSpeed), options.acceleration * Math.abs(throttle) * dt);
        else speed = approach(speed, 0, options.coast * dt);
        lateral *= Math.exp(-(handbrake ? options.driftGrip : options.grip) * dt);
        yawRate = -steer * options.steerRate * Math.min(Math.abs(speed) / 6, 1) / (1 + Math.abs(speed) * 0.015) * Math.sign(speed);
        const vertical = velocity.y;
        velocity.copy(forward).multiplyScalar(speed).addScaledVector(right, lateral);
        velocity.y = vertical;
        body.setLinvel(velocity, true);
      }
      body.setAngvel({ x: 0, y: yawRate, z: 0 }, true);
    },
    updateCamera() {
      if (!camera) return;
      basis(entry.renderRotation);
      target.copy(entry.renderPosition);
      target.y += size.y / 2;
      eye.copy(target).addScaledVector(forward, -options.cameraDistance);
      eye.y += options.cameraHeight;
      const hit = castSegment(target, eye, { exclude: handle, collisionGroups: config.collisionGroups });
      if (hit) {
        direction.copy(eye).sub(target).normalize();
        eye.copy(target).addScaledVector(direction, Math.max(0, hit.distance - 0.25));
      }
      camera.position.copy(eye);
      target.addScaledVector(forward, options.lookAhead);
      camera.up.copy(up);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    },
    dispose() {
      controller.stop();
      for (const off of listeners) off();
      release();
    }
  };
  listen(canvas?.ownerDocument.defaultView, "blur", pause);
  listen(canvas?.ownerDocument.defaultView, "keydown", (event) => {
    if (active && event.code === "KeyR" && !event.repeat && input?.isKeyDown("KeyR")) {
      if (config.onReset) config.onReset();
      else controller.reset();
    }
    if (active && event.code === "Escape" && input?.isKeyDown("Escape")) pause();
  });
  listen(canvas, "blur", pause);
  listen(canvas?.ownerDocument, "visibilitychange", () => {
    if (canvas.ownerDocument.hidden) pause();
  });
  listen(canvas, "mousedown", () => {
    if (enabled && !active) controller.start();
  });
  return controller;
}

// src/thirdPersonCamera.js
import * as THREE3 from "three";

// src/rpgInput.js
function createRpgControls({ canvas, enter, pause, look, turn, select, resetInput }) {
  const doc = canvas.ownerDocument, win = doc.defaultView;
  const buttons = /* @__PURE__ */ new Set(), listeners = [];
  let active = false, pointer = null, x = 0, y = 0, click = null;
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn);
    listeners.push(() => target.removeEventListener(name, fn));
  };
  function releaseCapture() {
    const id = pointer;
    pointer = null;
    if (id !== null && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
  }
  function reset() {
    buttons.clear();
    click = null;
    releaseCapture();
    resetInput();
  }
  function stop() {
    active = false;
    reset();
    pause();
  }
  function down(event) {
    if (!active || event.pointerType && event.pointerType !== "mouse" || ![0, 2].includes(event.button)) return;
    if (pointer !== null && pointer !== event.pointerId) return;
    canvas.focus({ preventScroll: true });
    pointer = event.pointerId;
    x = event.clientX;
    y = event.clientY;
    buttons.add(event.button);
    click = event.button === 0 && !buttons.has(2) ? { x, y } : null;
    if (buttons.has(2)) {
      turn();
      canvas.setPointerCapture?.(pointer);
      event.preventDefault();
    }
  }
  function move(event) {
    if (!active || pointer !== event.pointerId) return;
    let dx = event.clientX - x, dy = event.clientY - y;
    if (click) {
      if (Math.hypot(event.clientX - click.x, event.clientY - click.y) <= 5) return;
      dx = event.clientX - click.x;
      dy = event.clientY - click.y;
      click = null;
      canvas.setPointerCapture?.(pointer);
    }
    x = event.clientX;
    y = event.clientY;
    if (buttons.size && Number.isFinite(dx) && Number.isFinite(dy)) look(dx, dy, buttons.has(2));
  }
  function up3(event) {
    if (!active || pointer !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const selected = event.button === 0 && click && !buttons.has(2) && Math.hypot(event.clientX - click.x, event.clientY - click.y) <= 5 && event.clientX >= rect.left && event.clientX <= rect.left + rect.width && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
    buttons.delete(event.button);
    click = null;
    if (!buttons.size) releaseCapture();
    if (selected) select(event);
  }
  listen(canvas, "pointerdown", down);
  listen(doc, "pointermove", (event) => {
    if (pointer !== event.pointerId) return;
    if (typeof event.buttons === "number") {
      if (event.buttons & 2) {
        if (!buttons.has(2)) {
          x = event.clientX;
          y = event.clientY;
          click = null;
          turn();
          canvas.setPointerCapture?.(pointer);
        }
        buttons.add(2);
      } else buttons.delete(2);
      if (event.buttons & 1) buttons.add(0);
      else buttons.delete(0);
      if (!buttons.size) {
        reset();
        return;
      }
    }
    move(event);
  });
  listen(doc, "pointerup", up3);
  listen(canvas, "pointercancel", (event) => {
    if (event.pointerId === pointer) reset();
  });
  listen(canvas, "lostpointercapture", () => {
    if (pointer !== null) reset();
  });
  listen(canvas, "blur", reset);
  listen(canvas, "contextmenu", (event) => {
    if (active) event.preventDefault();
  });
  listen(win, "keydown", (event) => {
    if (active && event.code === "Escape") stop();
  });
  listen(win, "blur", stop);
  listen(doc, "visibilitychange", () => {
    if (doc.hidden) stop();
  });
  return {
    get turning() {
      return active && buttons.has(2);
    },
    get orbiting() {
      return active && buttons.has(0) && !buttons.has(2);
    },
    get walking() {
      return active && buttons.has(0) && buttons.has(2);
    },
    start() {
      reset();
      active = true;
      enter();
    },
    cancel: stop,
    update() {
    },
    dispose() {
      stop();
      for (const remove of listeners) remove();
    }
  };
}

// src/rpgProfile.js
var RPG_MOVEMENT_DEFAULTS = Object.freeze({ gravity: -20, jumpSpeed: 6.25 });
var RPG_BINDINGS = Object.freeze([
  { label: "W/S", description: "Forward / backward" },
  { label: "A/D", description: "Turn (strafe while RMB held)" },
  { label: "Q/E", description: "Strafe" },
  { label: "RMB drag", description: "Camera and character" },
  { label: "LMB click / drag", description: "Select / orbit view" },
  { label: "Wheel", description: "Zoom" },
  { label: "Space", description: "Jump" },
  { label: "Shift", description: "Run" },
  { label: "F", description: "Interact nearby", code: "KeyF" },
  { label: "1", description: "First ability", code: "Digit1", slot: 0 },
  { label: "2", description: "Second ability", code: "Digit2", slot: 1 },
  { label: "3", description: "Third ability", code: "Digit3", slot: 2 },
  { label: "C (hold)", description: "Sneak", code: "KeyC", feature: "sneak" },
  { label: "Escape", description: "Close dialogue / pause" }
]);
var SHARED_BINDINGS = [
  { label: "Space", description: "Jump" },
  { label: "Shift", description: "Run" },
  { label: "F", description: "Interact nearby", code: "KeyF" },
  { label: "1", description: "First ability", code: "Digit1", slot: 0 },
  { label: "2", description: "Second ability", code: "Digit2", slot: 1 },
  { label: "3", description: "Third ability", code: "Digit3", slot: 2 },
  { label: "R", description: "Reload", code: "KeyR", feature: "reload" },
  { label: "C (hold)", description: "Sneak", code: "KeyC", feature: "sneak" }
];
var RPG_POINTER_BINDINGS = Object.freeze({
  first: Object.freeze([
    { label: "WASD", description: "Move" },
    { label: "Mouse", description: "Look" },
    { label: "LMB", description: "First ability", slot: 0 },
    ...SHARED_BINDINGS,
    { label: "Escape", description: "Close dialogue / pause; click to resume" }
  ]),
  pointer: Object.freeze([
    { label: "WASD", description: "Move" },
    { label: "Mouse", description: "Camera and facing" },
    { label: "Wheel", description: "Zoom" },
    { label: "LMB", description: "First ability", slot: 0 },
    ...SHARED_BINDINGS,
    { label: "Escape", description: "Close dialogue / pause; click to resume" }
  ])
});
var RPG_CLASSIC_KEYS = Object.freeze({
  KeyA: "turnLeft",
  KeyD: "turnRight",
  ArrowLeft: "turnLeft",
  ArrowRight: "turnRight",
  KeyQ: "left",
  KeyE: "right"
});

// src/thirdPersonCamera.js
function thirdPersonOptions(config) {
  const settings = { yaw: 0, pitch: 0.3, distance: 6, minDistance: 2, maxDistance: 14, sensitivity: 23e-4, turnSpeed: 2 };
  for (const key of Object.keys(settings)) {
    settings[key] = config[key] ?? settings[key];
    if (!Number.isFinite(settings[key])) throw new Error(`Third-person ${key} must be finite.`);
  }
  if (settings.minDistance <= 0 || settings.maxDistance < settings.minDistance || settings.sensitivity <= 0 || settings.turnSpeed <= 0) throw new Error("Invalid third-person distance or sensitivity.");
  const offset = config.targetOffset ?? [0, 0.6, 0];
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite)) throw new Error("Third-person targetOffset must contain three finite numbers.");
  if (config.onAttack !== void 0 && typeof config.onAttack !== "function") throw new Error("Third-person onAttack must be a function.");
  if (config.onSelect !== void 0 && typeof config.onSelect !== "function") throw new Error("Third-person onSelect must be a function.");
  settings.controlMode = config.controlMode ?? "pointer";
  settings.keyboardLayout = config.keyboardLayout ?? "classic";
  if (!["pointer", "mmo"].includes(settings.controlMode)) throw new Error("Third-person controlMode must be pointer or mmo.");
  if (!["classic", "orbit"].includes(settings.keyboardLayout)) throw new Error("Third-person keyboardLayout must be classic or orbit.");
  settings.targetOffset = new THREE3.Vector3(...offset);
  settings.facing = config.facing ?? "camera";
  if (!["camera", "movement"].includes(settings.facing)) throw new Error("Third-person facing must be camera or movement.");
  return settings;
}
function thirdPersonKeyMappings(config) {
  if (config.controlMode !== "mmo") return {};
  return config.keyboardLayout === "orbit" ? { KeyQ: "turnLeft", KeyE: "turnRight" } : RPG_CLASSIC_KEYS;
}
function createThirdPersonCamera({ entry, config, input, castSegment, castRay, requireLive, release }) {
  const { canvas, camera } = config, doc = canvas.ownerDocument, options = thirdPersonOptions(config);
  const cursor = canvas.style.cursor, savedUp = camera.up.clone();
  const target = new THREE3.Vector3(), eye = new THREE3.Vector3(), direction = new THREE3.Vector3();
  let yaw = options.yaw, pitch = THREE3.MathUtils.clamp(options.pitch, -1.3, 1.45);
  let heading = yaw;
  let distance = THREE3.MathUtils.clamp(options.distance, options.minDistance, options.maxDistance);
  let enabled = false, active = false, suspended = false;
  const mmo = options.controlMode === "mmo";
  const mouseOptions = {
    canvas,
    doc,
    win: doc.defaultView,
    input,
    lockPointer: config.lockPointer !== false,
    getState: () => active ? "playing" : enabled ? "paused" : "ready",
    enter: () => {
      active = true;
      canvas.style.cursor = mmo ? "default" : "none";
      canvas.focus({ preventScroll: true });
    },
    pause: () => {
      active = false;
      canvas.style.cursor = cursor;
    },
    turn: () => {
      heading = yaw;
    },
    look: (dx, dy, turnCharacter) => {
      yaw -= dx * options.sensitivity;
      if (!mmo || turnCharacter) heading = yaw;
      pitch = THREE3.MathUtils.clamp(pitch + dy * options.sensitivity, -1.3, 1.45);
      controller.updateCamera();
    },
    fire: (event) => {
      if (active) config.onAttack?.(event);
    },
    release: () => {
    },
    select: (event) => {
      if (!config.onSelect) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pointer = new THREE3.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      camera.updateMatrixWorld();
      const ray = new THREE3.Raycaster();
      ray.setFromCamera(pointer, camera);
      const hit = castRay(ray.ray.origin, ray.ray.direction, { maxDistance: camera.far, exclude: entry.handle, collisionGroups: config.collisionGroups });
      config.onSelect({ event, ray: ray.ray, hit });
    },
    resetInput: () => {
      input.reset();
      entry.jumpRequested = false;
    },
    modeChanged: (mode) => {
      canvas.dataset.aimMode = mode;
    }
  };
  const mouse = mmo ? createRpgControls(mouseOptions) : createPointerControls(mouseOptions);
  const controller = {
    get active() {
      return active;
    },
    get enabled() {
      return enabled;
    },
    get locked() {
      return doc.pointerLockElement === canvas;
    },
    get facing() {
      return options.facing;
    },
    direction(out) {
      return out.set(-Math.sin(heading), 0, -Math.cos(heading));
    },
    /** Host look input (touch drag, gamepad) in mouse pixels; turns the character like a captured mouse. */
    look(dx, dy) {
      if (active) mouseOptions.look(dx, dy, true);
    },
    movement() {
      const move = input.getMovementVector();
      if (mmo && options.keyboardLayout === "classic" && mouse.turning) move.x += Number(input.isActionActive("turnRight")) - Number(input.isActionActive("turnLeft"));
      if (mmo && mouse.walking) move.z = -1;
      return move;
    },
    // start() also ends a pause(), so a pause menu can resume with it; canvas clicks cannot.
    start() {
      requireLive();
      suspended = false;
      enabled = true;
      controller.updateCamera();
      mouse.start();
    },
    // Cancelling fallback look has no capture-loss event, so end the round here.
    pause() {
      suspended = true;
      mouse.cancel();
      active = false;
      canvas.style.cursor = cursor;
    },
    resume() {
      controller.start();
    },
    stop() {
      suspended = false;
      enabled = active = false;
      mouse.cancel();
      canvas.style.cursor = cursor;
    },
    updateInput(dt) {
      mouse.update(dt);
      if (mmo && active && !(options.keyboardLayout === "classic" && mouse.turning)) {
        const turn = (Number(input.isActionActive("turnLeft")) - Number(input.isActionActive("turnRight"))) * options.turnSpeed * dt;
        heading += turn;
        if (!mouse.orbiting) yaw += turn;
      }
    },
    updateCamera() {
      target.copy(entry.renderPosition).add(options.targetOffset);
      direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      eye.copy(target).addScaledVector(direction, distance);
      const hit = castSegment(target, eye, { exclude: entry.handle, collisionGroups: config.collisionGroups });
      if (hit) eye.copy(target).addScaledVector(direction, Math.max(0.05, hit.distance - Math.max(0.25, camera.near * 2)));
      camera.position.copy(eye);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    },
    dispose() {
      controller.stop();
      mouse.dispose();
      canvas.removeEventListener("click", resume);
      canvas.removeEventListener("wheel", zoom);
      camera.up.copy(savedUp);
      release();
    }
  };
  function resume() {
    if (enabled && !active && !suspended) controller.start();
  }
  function zoom(event) {
    if (!active) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight || 720 : 1);
    distance = THREE3.MathUtils.clamp(distance * Math.exp(THREE3.MathUtils.clamp(pixels * 1e-3, -1, 1)), options.minDistance, options.maxDistance);
    controller.updateCamera();
  }
  canvas.addEventListener("click", resume);
  canvas.addEventListener("wheel", zoom, { passive: false });
  controller.updateCamera();
  return controller;
}

// src/staticMesh.js
import * as THREE4 from "three";
function staticMeshShape(mesh, RAPIER2, { surfaceUp } = {}) {
  if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.morphTargetInfluences?.length) throw new Error("addStaticMesh requires a static, non-instanced Three.js Mesh.");
  const geometry = mesh.geometry, positions = geometry?.getAttribute("position"), index = geometry?.getIndex();
  if (!positions || positions.itemSize !== 3 || positions.count < 3) throw new Error("Static mesh needs three-component vertex positions.");
  const count = index?.count ?? positions.count;
  let up3;
  if (surfaceUp !== void 0) {
    if (!Array.isArray(surfaceUp) || surfaceUp.length !== 3 || !surfaceUp.every(Number.isFinite)) throw new Error("surfaceUp must contain three finite numbers.");
    up3 = new THREE4.Vector3(...surfaceUp);
    if (up3.lengthSq() < 1e-12) throw new Error("surfaceUp must be nonzero.");
    up3.normalize();
  }
  if (count < 3 || count % 3) throw new Error("Static mesh indices must describe complete triangles.");
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count < count) throw new Error("Use a complete collision mesh rather than a partial drawRange.");
  mesh.updateWorldMatrix(true, false);
  const determinant = mesh.matrixWorld.determinant();
  if (!mesh.matrixWorld.elements.every(Number.isFinite) || Math.abs(determinant) < 1e-12) throw new Error("Static mesh transform must be finite and invertible.");
  const vertices = new Float32Array(positions.count * 3), indices = new Uint32Array(count), vertex = new THREE4.Vector3();
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) throw new Error("Static mesh vertices must be finite.");
    vertex.toArray(vertices, i * 3);
  }
  for (let i = 0; i < count; i++) {
    const value = index ? index.getX(i) : i;
    if (!Number.isInteger(value) || value < 0 || value >= positions.count) throw new Error("Static mesh index is out of bounds.");
    indices[i] = value;
  }
  const a = new THREE4.Vector3(), b = new THREE4.Vector3(), c = new THREE4.Vector3();
  for (let i = 0; i < count; i += 3) {
    let flip = determinant < 0;
    if (up3) {
      a.fromArray(vertices, indices[i] * 3);
      b.fromArray(vertices, indices[i + 1] * 3);
      c.fromArray(vertices, indices[i + 2] * 3);
      flip = b.sub(a).cross(c.sub(a)).dot(up3) < 0;
    }
    if (flip) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  return RAPIER2.ColliderDesc.trimesh(vertices, indices, RAPIER2.TriMeshFlags.FIX_INTERNAL_EDGES);
}

// src/mechanics.js
var cameraOwners = /* @__PURE__ */ new WeakMap();
var canvasOwners2 = /* @__PURE__ */ new WeakMap();
var visualOwners = /* @__PURE__ */ new WeakMap();
var up2 = new THREE5.Vector3(0, 1, 0);
function positive(value, name, zero = false) {
  if (!Number.isFinite(value) || (zero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${zero ? "non-negative" : "positive"}.`);
  return value;
}
var RUN_AXIS = 0.9;
var components = ["x", "y", "z"];
var ReadableVector3 = class extends THREE5.Vector3 {
};
for (let i = 0; i < 3; i++) Object.defineProperty(ReadableVector3.prototype, i, { get() {
  return this[components[i]];
}, set(value) {
  this[components[i]] = value;
} });
function readable(v) {
  return new ReadableVector3(v.x, v.y, v.z);
}
function vector(value, fallback = [0, 0, 0]) {
  value ??= fallback;
  if (Array.isArray(value) && value.length !== 3) throw new Error("Expected a three-component vector.");
  const v = Array.isArray(value) ? new THREE5.Vector3(...value) : new THREE5.Vector3(value.x, value.y, value.z);
  if (![v.x, v.y, v.z].every(Number.isFinite)) throw new Error("Expected a finite three-component vector.");
  return v;
}
function rotation(value = [0, 0, 0, 1]) {
  if (Array.isArray(value) && value.length !== 4) throw new Error("Expected a four-component quaternion.");
  const q = Array.isArray(value) ? new THREE5.Quaternion(...value) : new THREE5.Quaternion(value.x, value.y, value.z, value.w);
  if (![q.x, q.y, q.z, q.w].every(Number.isFinite) || q.lengthSq() < 1e-12) throw new Error("Expected a nonzero finite quaternion.");
  return q.normalize();
}
async function createMechanics(options = {}) {
  const fixedTimeStep = positive(options.fixedTimeStep ?? 1 / 60, "fixedTimeStep");
  const maxSubSteps = positive(options.maxSubSteps ?? 8, "maxSubSteps");
  if (!Number.isInteger(maxSubSteps)) throw new Error("maxSubSteps must be an integer.");
  const maxFrameDelta = positive(options.maxFrameDelta ?? 0.25, "maxFrameDelta");
  const maxCcdSubsteps = positive(options.maxCcdSubsteps ?? 4, "maxCcdSubsteps");
  if (!Number.isInteger(maxCcdSubsteps)) throw new Error("maxCcdSubsteps must be an integer.");
  const physics = await setupPhysics({ gravity: vector(options.gravity, [0, -9.81, 0]) });
  const { RAPIER: RAPIER2, world, eventQueue } = physics;
  world.integrationParameters.maxCcdSubsteps = maxCcdSubsteps;
  const entries = /* @__PURE__ */ new Map(), colliders = /* @__PURE__ */ new Map(), contacts = /* @__PURE__ */ new Map(), listeners = /* @__PURE__ */ new Set(), changedColliders = /* @__PURE__ */ new Set(), kinematicProps = /* @__PURE__ */ new Set();
  let nextId = 1, accumulator = 0, disposed = false, paused = false, advancing = false;
  const diagnostics = { frames: 0, fixedSteps: 0, simulatedSeconds: 0, droppedSeconds: 0, negativeDeltaFrames: 0 };
  const forward = new THREE5.Vector3(), right = new THREE5.Vector3(), desired = new THREE5.Vector3(), ride = new THREE5.Vector3();
  const heading = new THREE5.Quaternion(), parentRotation = new THREE5.Quaternion(), turn = new THREE5.Quaternion(), nextTurn = new THREE5.Quaternion();
  const identity = { x: 0, y: 0, z: 0, w: 1 }, still = { x: 0, y: 0, z: 0 }, down = { x: 0, y: -1, z: 0 }, up3 = { x: 0, y: 1, z: 0 };
  const faceRay = new RAPIER2.Ray({ x: 0, y: 0, z: 0 }, down);
  const live = () => {
    if (disposed) throw new Error("Mechanics is disposed.");
  };
  function requireEntry(handle) {
    live();
    const entry = entries.get(handle);
    if (!entry) throw new Error("Body does not belong to this live mechanics world.");
    return entry;
  }
  function notify(type, pair) {
    for (const fn of [...listeners]) {
      if (disposed) break;
      fn({ type, a: pair.a, b: pair.b });
    }
  }
  function readPose(entry, reset = false) {
    entry.position.copy(entry.body.translation());
    entry.quaternion.copy(entry.body.rotation());
    if (reset) {
      entry.previousPosition.copy(entry.position);
      entry.previousRotation.copy(entry.quaternion);
      entry.renderPosition.copy(entry.position);
      entry.renderRotation.copy(entry.quaternion);
    }
  }
  function bind(entry, object) {
    if (!object?.isObject3D) throw new Error("bindObject requires a Three.js Object3D.");
    const owner = visualOwners.get(object);
    if (owner) throw new Error("Release this visual's existing body binding before rebinding it.");
    entry.bindings.add(object);
    visualOwners.set(object, entry);
    present(entry, 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.bindings.delete(object);
      if (visualOwners.get(object) === entry) visualOwners.delete(object);
    };
  }
  function present(entry, alpha) {
    entry.renderPosition.lerpVectors(entry.previousPosition, entry.position, alpha);
    entry.renderRotation.copy(entry.previousRotation).slerp(entry.quaternion, alpha);
    for (const object of entry.bindings) {
      object.position.copy(entry.renderPosition);
      object.quaternion.copy(entry.renderRotation);
      if (object.parent) {
        object.parent.updateWorldMatrix(true, false);
        object.parent.worldToLocal(object.position);
        object.parent.getWorldQuaternion(parentRotation).invert();
        object.quaternion.premultiply(parentRotation);
      }
      object.updateMatrix();
    }
  }
  function remove(handle) {
    const entry = entries.get(handle);
    if (!entry) return;
    entries.delete(handle);
    colliders.delete(entry.collider.handle);
    changedColliders.delete(entry.collider);
    kinematicProps.delete(entry);
    entry.fps?.dispose();
    entry.third?.dispose();
    entry.vehicle?.dispose();
    entry.input?.dispose();
    for (const object of entry.bindings) if (visualOwners.get(object) === entry) visualOwners.delete(object);
    entry.bindings.clear();
    for (const [key, pair] of [...contacts]) {
      if (pair.a === handle || pair.b === handle) {
        contacts.delete(key);
        notify("end", pair);
      }
    }
    for (const [key, pair] of physicalContacts) if (pair.a === handle || pair.b === handle) physicalContacts.delete(key);
    if (!disposed) {
      if (entry.controller) world.removeCharacterController(entry.controller);
      world.removeRigidBody(entry.body);
    }
  }
  function addBody(config = {}, meshDescriptor) {
    live();
    const type = config.type ?? "fixed", shape = config.shape ?? { type: "box", size: [1, 1, 1] };
    const position = vector(config.position), quaternion = rotation(config.quaternion);
    const factory = { fixed: "fixed", dynamic: "dynamic", kinematic: "kinematicPositionBased" }[type];
    if (!factory) throw new Error("Body type must be fixed, dynamic or kinematic.");
    let descriptor = meshDescriptor;
    if (!descriptor) {
      if (shape.type === "box") {
        const size = vector(shape.size, [1, 1, 1]);
        for (const n of size.toArray()) positive(n, "Box size");
        descriptor = RAPIER2.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
      } else if (shape.type === "sphere") descriptor = RAPIER2.ColliderDesc.ball(positive(shape.radius ?? 0.5, "radius"));
      else if (shape.type === "capsule") descriptor = RAPIER2.ColliderDesc.capsule(positive(shape.height ?? 1.1, "height", true) / 2, positive(shape.radius ?? 0.35, "radius"));
      else throw new Error("Shape must be box, sphere or capsule.");
    }
    descriptor.setFriction(positive(config.friction ?? 0.7, "friction", true)).setRestitution(positive(config.restitution ?? 0, "restitution", true)).setSensor(config.sensor ?? false).setActiveEvents(RAPIER2.ActiveEvents.COLLISION_EVENTS).setActiveCollisionTypes(RAPIER2.ActiveCollisionTypes.ALL);
    if (config.collisionGroups !== void 0) descriptor.setCollisionGroups(config.collisionGroups);
    const body = world.createRigidBody(RAPIER2.RigidBodyDesc[factory]().setTranslation(position.x, position.y, position.z).setRotation(quaternion));
    let collider;
    try {
      collider = world.createCollider(descriptor, body);
    } catch (error) {
      world.removeRigidBody(body);
      throw error;
    }
    const entry = { body, collider, position, quaternion, previousPosition: position.clone(), previousRotation: quaternion.clone(), renderPosition: position.clone(), renderRotation: quaternion.clone(), bindings: /* @__PURE__ */ new Set(), controller: null, state: null, fps: null, input: null };
    if (type === "kinematic") kinematicProps.add(entry);
    const handle = {
      id: nextId++,
      data: config.data ?? {},
      get position() {
        return readable(requireEntry(handle).position.clone());
      },
      get quaternion() {
        return requireEntry(handle).quaternion.clone();
      },
      get grounded() {
        const e = requireEntry(handle);
        return e.vehicle?.grounded ?? e.state?.grounded ?? false;
      },
      get removed() {
        return !entries.has(handle);
      },
      setVelocity(value) {
        const e = requireEntry(handle), v = vector(value);
        if (e.state) e.velocity.copy(v);
        else if (e.body.isDynamic()) e.body.setLinvel(v, true);
        else throw new Error("setVelocity requires a character or dynamic body; move kinematic props with moveTo.");
      },
      moveTo(value, q) {
        const e = requireEntry(handle), p = vector(value);
        if (!e.body.isKinematic() || e.state) throw new Error("moveTo requires a kinematic prop.");
        e.body.setNextKinematicTranslation(p);
        if (q !== void 0) e.body.setNextKinematicRotation(rotation(q));
      },
      setRotation(value) {
        const e = requireEntry(handle), q = rotation(value);
        e.body.setRotation(q, true);
        if (e.body.isKinematic()) e.body.setNextKinematicRotation(q);
        e.quaternion.copy(q);
        e.previousRotation.copy(q);
        changedColliders.add(e.collider);
      },
      teleport(value) {
        const e = requireEntry(handle), p = vector(value);
        p.y += e.spawnClearance ?? 0;
        if (e.body.isKinematic() && !e.state) (e.carry ??= new THREE5.Vector3()).add(vector(e.body.translation()).negate().add(p));
        e.body.setTranslation(p, true);
        if (e.body.isKinematic()) e.body.setNextKinematicTranslation(p);
        e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        if (e.state) {
          e.state.verticalVelocity = 0;
          e.state.grounded = false;
          e.state.jumpHeld = !!e.input?.isActionActive("jump");
          e.jumpRequested = false;
          e.velocity.set(0, 0, 0);
          e.boost.set(0, 0, 0);
          e.inputVelocity.set(0, 0, 0);
          e.jumpPressed = false;
        }
        changedColliders.add(e.collider);
        e.vehicle?.resetMotion();
        readPose(e, true);
        present(e, 1);
        e.fps?.update();
        e.third?.updateCamera();
        e.vehicle?.updateCamera();
      },
      bindObject(object) {
        return bind(requireEntry(handle), object);
      },
      remove: () => remove(handle)
    };
    entry.handle = handle;
    entries.set(handle, entry);
    colliders.set(collider.handle, handle);
    changedColliders.add(collider);
    return handle;
  }
  function addCharacter(config = {}) {
    const jumpSpeed = positive(config.jumpSpeed ?? 7, "jumpSpeed", true);
    const forwardAxis = config.forwardAxis ?? "+Z";
    if (forwardAxis !== "+Z" && forwardAxis !== "-Z") throw new Error("forwardAxis must be +Z or -Z.");
    const spawnClearance = positive(config.spawnClearance ?? capsuleSpawnClearance(physics, fixedTimeStep), "spawnClearance", true);
    const position = vector(config.position, [0, 2, 0]);
    position.y += spawnClearance;
    const handle = addBody({ ...config, position, type: "kinematic", shape: { type: "capsule", radius: config.radius ?? 0.35, height: config.height ?? 1.1 } });
    try {
      const entry = entries.get(handle);
      entry.controller = createCapsuleController(physics);
      entry.state = { enabled: true, grounded: false, verticalVelocity: 0, jumpHeld: false };
      kinematicProps.delete(entry);
      entry.velocity = vector(config.velocity);
      entry.spawnClearance = spawnClearance;
      entry.forwardAxis = forwardAxis;
      entry.autoFaceMovement = config.autoFaceMovement === true;
      entry.jumpSpeed = jumpSpeed;
      entry.jumpRequested = false;
      entry.jumpPressed = false;
      entry.boost = new THREE5.Vector3();
      entry.inputVelocity = new THREE5.Vector3();
      Object.defineProperties(handle, {
        /** World velocity from walking, pushes and the vertical speed (0 while standing). */
        velocity: { get: () => {
          const e = requireEntry(handle);
          return readable(e.inputVelocity.clone().add(e.boost).setY(e.state.grounded && e.state.verticalVelocity <= 0 ? 0 : e.state.verticalVelocity));
        } },
        /** A new jump press this fixed step that the engine did not use for a ground jump. */
        jumpPressed: { get: () => requireEntry(handle).jumpPressed },
        jumpHeld: { get: () => requireEntry(handle).state.jumpHeld }
      });
      handle.setMotion = (value) => {
        const e = requireEntry(handle), v = vector(value);
        e.state.verticalVelocity = v.y;
        e.boost.set(v.x - e.inputVelocity.x, 0, v.z - e.inputVelocity.z);
      };
      handle.faceDirection = (value) => {
        const e = requireEntry(handle), direction = vector(value);
        if (direction.x * direction.x + direction.z * direction.z < 1e-12) return;
        const sign = e.forwardAxis === "+Z" ? 1 : -1;
        handle.setRotation(heading.setFromAxisAngle(up3, Math.atan2(sign * direction.x, sign * direction.z)));
      };
      handle.jump = () => {
        const e = requireEntry(handle);
        if (!e.state.grounded || e.state.jumpHeld || e.jumpSpeed === 0) return false;
        e.jumpRequested = true;
        return true;
      };
      return handle;
    } catch (error) {
      remove(handle);
      throw error;
    }
  }
  async function addThirdPersonPlayer(config = {}) {
    live();
    const { camera, canvas } = config;
    if (!camera?.isPerspectiveCamera || !canvas?.ownerDocument || camera.parent && !camera.parent.isScene) throw new Error("Third-person player requires a scene-root perspective camera and the host canvas.");
    if (cameraOwners.has(camera) || canvasOwners2.has(canvas)) throw new Error("Release the existing controller before claiming this camera or canvas.");
    thirdPersonOptions(config);
    const speed = positive(config.speed ?? 5, "speed"), runSpeed = positive(config.runSpeed ?? 8, "runSpeed");
    const handle = addCharacter({ ...config, forwardAxis: config.forwardAxis ?? "-Z" }), entry = entries.get(handle);
    cameraOwners.set(camera, entry);
    canvasOwners2.set(canvas, entry);
    const release = () => {
      if (cameraOwners.get(camera) === entry) cameraOwners.delete(camera);
      if (canvasOwners2.get(canvas) === entry) canvasOwners2.delete(canvas);
    };
    try {
      entry.input = await setupInput({ canvas, inputWindow: canvas.ownerDocument.defaultView, autoFocus: false, keyMappings: thirdPersonKeyMappings(config) });
      if (disposed || !entries.has(handle)) {
        entry.input.dispose();
        throw new Error("Third-person player was removed during input initialization.");
      }
      entry.speed = speed;
      entry.runSpeed = runSpeed;
      entry.camera = camera;
      entry.third = createThirdPersonCamera({ entry, config, input: entry.input, castSegment: api.castSegment, castRay, requireLive: () => requireEntry(handle), release });
      for (const name of ["active", "enabled", "locked"]) Object.defineProperty(handle, name, { get: () => entry.third[name] });
      for (const name of ["start", "stop", "pause", "resume"]) handle[name] = () => entry.third[name]();
      handle.setAction = (action, enabled) => {
        requireEntry(handle);
        entry.input.setAction(action, enabled);
      };
      handle.setAxis = (x, z) => {
        requireEntry(handle);
        entry.input.setAxis(x, z);
      };
      handle.look = (dx, dy) => {
        requireEntry(handle);
        entry.third.look(dx, dy);
      };
      handle.setMoveSpeed = (walk, run = walk) => {
        requireEntry(handle);
        const speed2 = positive(walk, "speed", true), runSpeed2 = positive(run, "runSpeed", true);
        entry.speed = speed2;
        entry.runSpeed = runSpeed2;
      };
      return handle;
    } catch (error) {
      release();
      remove(handle);
      throw error;
    }
  }
  async function addFpsPlayer(config = {}) {
    live();
    const { camera, canvas } = config;
    if (!camera?.isPerspectiveCamera || !canvas?.ownerDocument) throw new Error("FPS player requires the host's perspective camera and canvas.");
    if (cameraOwners.has(camera) || canvasOwners2.has(canvas)) throw new Error("Release the existing FPS player before claiming this camera or canvas.");
    const fpsOptions = firstPersonOptions({ ...config, hideBody: false });
    const speed = positive(config.speed ?? 5, "speed"), runSpeed = positive(config.runSpeed ?? 8, "runSpeed"), jumpSpeed = positive(config.jumpSpeed ?? 7, "jumpSpeed", true);
    const handle = addCharacter({ ...config, forwardAxis: "-Z" }), entry = entries.get(handle);
    cameraOwners.set(camera, entry);
    canvasOwners2.set(canvas, entry);
    try {
      entry.input = await setupInput({ canvas, inputWindow: canvas.ownerDocument.defaultView, autoFocus: false });
      if (disposed || !entries.has(handle)) {
        entry.input.dispose();
        throw new Error("FPS player was removed during input initialization.");
      }
      entry.player = entry.state;
      entry.speed = speed;
      entry.runSpeed = runSpeed;
      entry.jumpSpeed = jumpSpeed;
      entry.camera = camera;
      entry.fps = createFirstPersonCamera({
        entity: entry,
        camera,
        canvas,
        controls: { enabled: false },
        input: entry.input,
        world: { has: (candidate) => entries.get(handle) === candidate },
        getPosition: () => entry.renderPosition,
        onDispose() {
          if (cameraOwners.get(camera) === entry) cameraOwners.delete(camera);
          if (canvasOwners2.get(canvas) === entry) canvasOwners2.delete(canvas);
        }
      }, fpsOptions);
      Object.defineProperties(handle, {
        active: { get: () => entry.fps.active },
        locked: { get: () => entry.fps.locked },
        enabled: { get: () => entry.fps.enabled }
      });
      Object.assign(handle, {
        start: () => {
          live();
          entry.fps.start();
        },
        stop: () => entry.fps.stop(),
        pause: () => entry.fps.pause(),
        resume: () => {
          live();
          entry.fps.resume();
        },
        setAction: (action, enabled) => {
          requireEntry(handle);
          entry.input.setAction(action, enabled);
        },
        setAxis: (x, z) => {
          requireEntry(handle);
          entry.input.setAxis(x, z);
        },
        look: (dx, dy) => {
          requireEntry(handle);
          entry.fps.look(dx, dy);
        },
        setMoveSpeed: (walk, run = walk) => {
          requireEntry(handle);
          entry.speed = positive(walk, "speed", true);
          entry.runSpeed = positive(run, "runSpeed", true);
        }
      });
      return handle;
    } catch (error) {
      if (cameraOwners.get(camera) === entry) cameraOwners.delete(camera);
      if (canvasOwners2.get(canvas) === entry) canvasOwners2.delete(canvas);
      remove(handle);
      throw error;
    }
  }
  async function addArcadeVehicle(config = {}) {
    live();
    const { camera, canvas } = config;
    if (camera && (!camera.isPerspectiveCamera || camera.parent && !camera.parent.isScene)) throw new Error("Vehicle camera must be a perspective camera at the scene root.");
    if (canvas && !canvas.ownerDocument) throw new Error("Vehicle input requires the host canvas.");
    if (camera && cameraOwners.has(camera) || canvas && canvasOwners2.has(canvas)) throw new Error("Release the existing controller before claiming this camera or canvas.");
    const settings = arcadeVehicleOptions(config), size = vector(config.size, [1.8, 0.8, 3.6]);
    for (const n of size.toArray()) positive(n, "Vehicle size");
    const handle = addBody({ ...config, type: "dynamic", shape: { type: "box", size }, position: config.position ?? [0, 1, 0], quaternion: new THREE5.Quaternion().setFromAxisAngle(up3, settings.heading), sensor: false });
    const entry = entries.get(handle);
    if (camera) cameraOwners.set(camera, entry);
    if (canvas) canvasOwners2.set(canvas, entry);
    const release = () => {
      if (camera && cameraOwners.get(camera) === entry) cameraOwners.delete(camera);
      if (canvas && canvasOwners2.get(canvas) === entry) canvasOwners2.delete(canvas);
    };
    try {
      if (canvas) entry.input = await setupInput({ canvas, inputWindow: canvas.ownerDocument.defaultView, autoFocus: false, keyMappings: { Space: "handbrake", KeyR: "reset" } });
      if (disposed || !entries.has(handle)) {
        entry.input?.dispose();
        throw new Error("Vehicle was removed during input initialization.");
      }
      entry.collider.setFrictionCombineRule(RAPIER2.CoefficientCombineRule.Min);
      entry.vehicle = createArcadeVehicle({ entry, config, size, input: entry.input, castRay, castSegment: api.castSegment, requireLive: () => requireEntry(handle), release });
      for (const name of ["active", "enabled", "speed"]) Object.defineProperty(handle, name, { get: () => entry.vehicle[name] });
      for (const name of ["start", "stop", "setControls", "reset"]) handle[name] = (...args) => entry.vehicle[name](...args);
      entry.vehicle.updateCamera();
      return handle;
    } catch (error) {
      release();
      remove(handle);
      throw error;
    }
  }
  function contactKey(a, b) {
    return a.id < b.id ? `${a.id}/${b.id}` : `${b.id}/${a.id}`;
  }
  const physicalContacts = /* @__PURE__ */ new Map();
  function processContacts() {
    eventQueue.drainCollisionEvents((a, b, started) => {
      const first = colliders.get(a), second = colliders.get(b);
      if (!first || !second) return;
      const key = contactKey(first, second);
      if (started) physicalContacts.set(key, { a: first, b: second });
      else physicalContacts.delete(key);
    });
    const current = /* @__PURE__ */ new Map();
    for (const [key, pair] of physicalContacts) {
      if (entries.has(pair.a) && entries.has(pair.b)) current.set(key, pair);
      else physicalContacts.delete(key);
    }
    for (const entry of entries.values()) if (entry.controller) {
      for (let i = 0; i < entry.controller.numComputedCollisions(); i++) {
        const c = entry.controller.computedCollision(i)?.collider, other = c && colliders.get(c.handle);
        if (other && !c.isSensor()) current.set(contactKey(entry.handle, other), { a: entry.handle, b: other });
      }
      const floor = entry.riding && entry.standingOn && colliders.get(entry.standingOn.handle);
      if (floor) current.set(contactKey(entry.handle, floor), { a: entry.handle, b: floor });
    }
    for (const [key, pair] of [...contacts]) if (!current.has(key)) {
      contacts.delete(key);
      notify("end", pair);
    }
    for (const [key, pair] of current) if (!contacts.has(key) && entries.has(pair.a) && entries.has(pair.b)) {
      contacts.set(key, pair);
      notify("start", pair);
    }
  }
  function step(dt) {
    for (const e of entries.values()) {
      e.previousPosition.copy(e.position);
      e.previousRotation.copy(e.quaternion);
      e.vehicle?.step(dt);
      if (!e.state) continue;
      desired.copy(e.velocity);
      let jumpDown = e.jumpRequested;
      e.jumpRequested = false;
      const player = e.fps ?? e.third;
      if (player) {
        const move = player.active ? e.third ? e.third.movement() : e.input.getMovementVector() : { x: 0, z: 0 };
        if (e.third) e.third.direction(forward);
        else e.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, up3).normalize();
        desired.copy(right).multiplyScalar(move.x).addScaledVector(forward, -move.z);
        if (desired.lengthSq() > 1) desired.normalize();
        desired.multiplyScalar(e.input.isActionActive("run") || e.input.getAxisLength?.() > RUN_AXIS ? e.runSpeed : e.speed);
        const pressed = e.input.consumeActionPress("jump");
        jumpDown = player.active && (jumpDown || e.input.isActionActive("jump") || pressed);
        if (player.active && (e.third?.facing !== "movement" || desired.lengthSq() > 1e-8)) {
          const face = e.third?.facing === "movement" ? desired : forward;
          const sign = e.forwardAxis === "+Z" ? 1 : -1;
          e.body.setNextKinematicRotation(heading.setFromAxisAngle(up3, Math.atan2(sign * face.x, sign * face.z)));
        }
      } else if (e.autoFaceMovement && desired.x * desired.x + desired.z * desired.z > 1e-12) {
        const sign = e.forwardAxis === "+Z" ? 1 : -1;
        e.body.setNextKinematicRotation(heading.setFromAxisAngle(up3, Math.atan2(sign * desired.x, sign * desired.z)));
      }
      e.inputVelocity.set(desired.x, 0, desired.z);
      desired.add(e.boost);
      let floors;
      if (e.state.grounded) {
        const support = supportUnder(e)?.body, carry = support && entries.get(support)?.carry;
        if (carry && carry.lengthSq() > 0 && carry.lengthSq() < 1) {
          e.body.setTranslation(vector(e.body.translation()).add(carry), true);
          world.propagateModifiedBodyPositionsToColliders();
        }
        const under = kinematicProps.size ? kinematicFloorsUnder(e, support) : [];
        const aside = support && !kinematicProps.has(entries.get(support)) && !entries.get(support)?.body.isDynamic();
        if (under.length && (aside ? ride.set(0, 0, 0) : stepAt(under[0].body, feetOf(e), ride)).lengthSq() < 1) floors = under.map((prop) => prop.collider);
      }
      if (floors) {
        const at = e.body.translation();
        (e.carried ??= new THREE5.Vector3()).set(at.x + ride.x, at.y + ride.y, at.z + ride.z);
      }
      const wasHeld = e.state.jumpHeld, wasGrounded = e.state.grounded;
      e.riding = moveCharacter({ physics, body: e.body, collider: e.collider, controller: e.controller, state: e.state, velocity: desired, jumpDown, jumpSpeed: e.jumpSpeed ?? 0, floors, carry: ride }, dt);
      e.floors = e.riding ? floors : null;
      if (e.riding) e.rideReach = ride.length() + Math.max(0, e.body.nextTranslation().y - e.body.translation().y - ride.y);
      e.jumpPressed = jumpDown && !wasHeld && !(wasGrounded && (e.jumpSpeed ?? 0) > 0);
      e.boost.multiplyScalar(Math.exp(-(e.state.grounded ? 10 : 1.5) * dt));
      if (e.boost.lengthSq() < 1e-6) e.boost.set(0, 0, 0);
    }
    for (const e of entries.values()) e.carry?.set(0, 0, 0);
    world.timestep = dt;
    world.step(eventQueue);
    let settled = false;
    for (const e of entries.values()) if (e.riding) {
      settle(e);
      settled = true;
    }
    if (settled) world.propagateModifiedBodyPositionsToColliders();
    changedColliders.clear();
    for (const e of entries.values()) readPose(e);
    processContacts();
  }
  function feetOf(e) {
    const t = e.body.translation();
    return { x: t.x, y: t.y - e.collider.halfHeight() - e.collider.radius(), z: t.z };
  }
  function stepAt(body, point, out) {
    const p = body.translation(), q = body.rotation(), n = body.nextRotation();
    turn.set(q.x, q.y, q.z, q.w).invert().premultiply(nextTurn.set(n.x, n.y, n.z, n.w));
    return out.set(point.x - p.x, point.y - p.y, point.z - p.z).applyQuaternion(turn).add(body.nextTranslation()).sub(point);
  }
  function kinematicFloorsUnder(e, centre) {
    const feet = feetOf(e), found = [];
    e.footprint ??= new RAPIER2.Cylinder(0.1, e.collider.radius() * 0.95);
    world.intersectionsWithShape({ x: feet.x, y: feet.y - 0.05, z: feet.z }, identity, e.footprint, (collider) => {
      const prop = entries.get(colliders.get(collider.handle));
      if (kinematicProps.has(prop) && walkable(e, collider)) found.push(prop);
      return true;
    }, RAPIER2.QueryFilterFlags.EXCLUDE_SENSORS, void 0, e.collider);
    if (centre && kinematicProps.has(entries.get(centre)) && !found.some((prop) => prop.handle === centre)) return [];
    return found.sort((a, b) => (b.handle === centre) - (a.handle === centre));
  }
  function soleOf(e) {
    const inset = e.collider.radius() * 0.2;
    e.sole ??= { ball: new RAPIER2.Ball(e.collider.radius() - inset), inset };
    return e.sole;
  }
  function walkable(e, collider) {
    const t = e.body.translation(), { ball, inset } = soleOf(e);
    const start = { x: t.x, y: t.y - e.collider.halfHeight() + 0.1, z: t.z };
    const hit = collider.castShape(still, ball, start, identity, down, 0, 0.3 + inset, false);
    if (!hit || hit.time_of_impact <= 0) return false;
    const flattest = Math.cos(e.controller.maxSlopeClimbAngle()) - 1e-3;
    return -hit.normal2.y >= flattest || faceAt(e, collider, { x: start.x, y: start.y - hit.time_of_impact, z: start.z }, hit.normal2)?.y >= flattest;
  }
  function faceAt(e, collider, centre, n) {
    const r = soleOf(e).ball.radius, across = Math.hypot(n.x, n.z), nudge = across > 1e-6 ? 0.02 / across : 0;
    faceRay.origin = { x: centre.x + n.x * (r + nudge), y: centre.y + n.y * r + 0.05, z: centre.z + n.z * (r + nudge) };
    const face = collider.castRayAndGetNormal(faceRay, 0.1, true);
    return face && face.timeOfImpact > 0 ? face.normal : null;
  }
  function settle(e) {
    const t = e.body.translation(), lift = 0.1 + e.rideReach, { ball, inset } = soleOf(e), r = ball.radius;
    const offset = e.controller.offset(), slope = e.controller.maxSlopeClimbAngle(), flattest = Math.cos(slope) - 1e-3;
    const start = { x: t.x, y: t.y - e.collider.halfHeight() + lift, z: t.z };
    const riding = e.floors, touch = (skip) => {
      const hit2 = world.castShape(start, identity, down, ball, 0, 2 * lift + inset, false, RAPIER2.QueryFilterFlags.EXCLUDE_SENSORS, void 0, e.collider, void 0, skip === void 0 ? void 0 : (c) => c.handle !== skip);
      const centre2 = hit2 && { x: start.x, y: start.y - hit2.time_of_impact, z: start.z };
      return { hit: hit2, n: hit2?.normal2, centre: centre2, face: hit2 && faceAt(e, hit2.collider, centre2, hit2.normal2) };
    };
    let { hit, n, centre, face } = touch();
    if (hit && !riding.some((f) => f.handle === hit.collider.handle) && -n.y < flattest && !(face?.y >= flattest)) ({ hit, n, centre, face } = touch(hit.collider.handle));
    const reach = e.collider.radius() + offset, across = hit ? Math.hypot(n.x, n.z) * r : 0;
    const floor = hit && n.y < 0 && across <= reach * Math.sin(slope) + 1e-3 && (-n.y >= flattest || face?.y >= flattest) ? hit : null;
    e.state.grounded = !!floor;
    e.standingOn = floor?.collider;
    if (!floor) return;
    const onFace = !face || face.x * -n.x + face.y * -n.y + face.z * -n.z > 0.999;
    let y = e.collider.halfHeight() + (onFace ? centre.y + (inset + offset) / -n.y : centre.y + n.y * r + Math.sqrt(reach * reach - across * across));
    const dy = y - t.y;
    if (Math.abs(dy) > 1e-4) {
      e.hull ??= new RAPIER2.Capsule(e.collider.halfHeight() + 0.03, e.collider.radius() - 0.03);
      const room = world.castShape(t, identity, dy > 0 ? up3 : down, e.hull, 0, Math.abs(dy) + offset, false, RAPIER2.QueryFilterFlags.EXCLUDE_SENSORS, void 0, e.collider, void 0, (c) => !riding.some((f) => f.handle === c.handle));
      const allowed = room ? Math.max(0, room.time_of_impact - offset) : Math.abs(dy);
      if (dy < 0 && allowed < -dy - 1e-3 && -room.normal2.y < flattest) {
        const m = room.normal2, rest = -dy - allowed, k = rest * m.y / (m.x * m.x + m.z * m.z);
        const from = { x: t.x, y: t.y - allowed, z: t.z }, path = new THREE5.Vector3(k * m.x, -rest, k * m.z), span = path.length();
        const blocked = world.castShape(from, identity, path.divideScalar(span), e.hull, 0, span, false, RAPIER2.QueryFilterFlags.EXCLUDE_SENSORS, void 0, e.collider, void 0, (c) => !riding.some((f) => f.handle === c.handle));
        if (blocked && blocked.time_of_impact < span - 1e-3) {
          e.state.grounded = false;
          e.standingOn = null;
          return;
        }
        e.body.setTranslation({ x: from.x + k * m.x, y, z: from.z + k * m.z }, true);
        return;
      }
      if (dy > 0 && allowed < dy - 1e-3) {
        e.body.setTranslation({ x: e.carried.x, y: t.y + allowed, z: e.carried.z }, true);
        return;
      }
      y = t.y + Math.sign(dy) * allowed;
    }
    e.body.setTranslation({ x: t.x, y, z: t.z }, true);
  }
  function supportUnder(e) {
    const t = e.body.translation(), feet = e.collider.halfHeight() + e.collider.radius();
    return castRay([t.x, t.y - feet + 0.05, t.z], [0, -1, 0], { maxDistance: 0.25, exclude: e.handle });
  }
  function castRay(origin, direction, config = {}) {
    live();
    const o = vector(origin), d = vector(direction);
    if (d.lengthSq() < 1e-12) throw new Error("Ray direction must be nonzero.");
    d.normalize();
    const maxDistance = positive(config.maxDistance ?? 100, "maxDistance");
    const excluded = new Set(config.exclude ? Array.isArray(config.exclude) ? config.exclude : [config.exclude] : []);
    const included = config.bodies ? new Set(config.bodies) : null;
    world.propagateModifiedBodyPositionsToColliders();
    const ray = new RAPIER2.Ray(o, d);
    const accepts = (collider) => {
      const body = colliders.get(collider.handle);
      if (!body || excluded.has(body) || included && !included.has(body) || !config.sensors && collider.isSensor()) return false;
      if (config.collisionGroups !== void 0) {
        const groups = collider.collisionGroups(), filter = config.collisionGroups;
        if (!(groups >>> 16 & (filter & 65535)) || !(filter >>> 16 & (groups & 65535))) return false;
      }
      return true;
    };
    let hit = world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      config.sensors ? void 0 : RAPIER2.QueryFilterFlags.EXCLUDE_SENSORS,
      config.collisionGroups,
      void 0,
      void 0,
      (collider) => !changedColliders.has(collider) && accepts(collider)
    );
    for (const collider of changedColliders) if (accepts(collider)) {
      const direct = collider.castRayAndGetNormal(ray, hit?.timeOfImpact ?? maxDistance, true);
      if (direct && (!hit || direct.timeOfImpact < hit.timeOfImpact)) hit = { ...direct, collider };
    }
    if (!hit) return null;
    return { body: colliders.get(hit.collider.handle), point: readable(o.addScaledVector(d, hit.timeOfImpact)), normal: readable(hit.normal), distance: hit.timeOfImpact };
  }
  const api = {
    addBody,
    addCharacter,
    addFpsPlayer,
    addThirdPersonPlayer,
    addArcadeVehicle,
    castRay,
    addStaticMesh(mesh, config = {}) {
      live();
      return addBody({ friction: config.friction, restitution: config.restitution, sensor: config.sensor, collisionGroups: config.collisionGroups, data: config.data, type: "fixed" }, staticMeshShape(mesh, RAPIER2, config));
    },
    castSegment(from, to, config = {}) {
      const origin = vector(from), direction = vector(to).sub(origin), distance = direction.length();
      if (!distance) {
        live();
        return null;
      }
      return castRay(origin, direction, { ...config, maxDistance: distance });
    },
    onCollision(fn) {
      live();
      if (typeof fn !== "function") throw new Error("Collision listener must be a function.");
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    advance(dt, { paused: shouldPause = false, beforeStep, afterStep } = {}) {
      live();
      if (!Number.isFinite(dt)) throw new Error("dt must be finite.");
      if (advancing) throw new Error("Mechanics.advance cannot be called recursively.");
      if (dt < 0) {
        diagnostics.negativeDeltaFrames++;
        dt = 0;
      }
      advancing = true;
      try {
        if (options.autoPause !== false) for (const e of entries.values()) {
          const controller = e.fps ?? e.third ?? e.vehicle;
          if (e.input && controller?.enabled && !controller.active) shouldPause = true;
        }
        const frameDelta = Math.min(dt, maxFrameDelta);
        diagnostics.frames++;
        if (shouldPause !== paused) {
          accumulator = 0;
          paused = shouldPause;
          for (const e of entries.values()) {
            if (paused) {
              e.input?.reset();
              e.vehicle?.clear();
              e.jumpRequested = false;
            }
            readPose(e, true);
          }
        }
        for (const e of entries.values()) e.fps?.update();
        for (const e of entries.values()) e.third?.updateInput(paused ? 0 : frameDelta);
        if (paused) {
          for (const e of entries.values()) {
            e.third?.updateCamera();
            e.vehicle?.updateCamera();
          }
          return;
        }
        diagnostics.droppedSeconds += dt - frameDelta;
        accumulator += frameDelta;
        let steps = 0;
        while (accumulator + 1e-10 >= fixedTimeStep && steps < maxSubSteps) {
          beforeStep?.(fixedTimeStep);
          if (disposed) return;
          step(fixedTimeStep);
          if (disposed) return;
          accumulator = Math.max(0, accumulator - fixedTimeStep);
          diagnostics.fixedSteps++;
          diagnostics.simulatedSeconds += fixedTimeStep;
          steps++;
          afterStep?.(fixedTimeStep);
          if (disposed) return;
        }
        if (accumulator + 1e-10 >= fixedTimeStep) {
          const dropped = Math.floor((accumulator + 1e-10) / fixedTimeStep) * fixedTimeStep;
          accumulator = Math.max(0, accumulator - dropped);
          diagnostics.droppedSeconds += dropped;
        }
        const alpha = options.interpolate === false ? 1 : Math.min(1, accumulator / fixedTimeStep);
        for (const e of entries.values()) {
          present(e, alpha);
          e.fps?.update();
          e.third?.updateCamera();
          e.vehicle?.updateCamera();
        }
      } finally {
        advancing = false;
      }
    },
    getDiagnostics: () => ({ ...diagnostics, bodies: entries.size, contacts: contacts.size, disposed }),
    get physics() {
      live();
      return { RAPIER: RAPIER2, world };
    },
    dispose() {
      if (disposed) return;
      listeners.clear();
      for (const handle of [...entries.keys()]) remove(handle);
      contacts.clear();
      physicalContacts.clear();
      disposed = true;
      physics.dispose();
    }
  };
  return api;
}

// src/actorAnimation.js
import * as THREE6 from "three";
var LOCOMOTION = {
  idle: [/^idle$/i, /idle/i],
  walk: [/^walk$/i, /walk/i],
  run: [/^run$/i, /^sprint/i, /run|sprint/i],
  air: [/^jump_loop$/i, /fall/i, /^jump$/i, /jump/i]
};
var FADE = 0.2;
var AIR_DELAY = 0.15;
function modelParts(model, animations) {
  const root = model?.isObject3D ? model : model?.scene;
  return { root, clips: animations ?? (model?.isObject3D ? model.animations : model?.animations) ?? [] };
}
function createLocomotion(root, clips, { speed = 5, runSpeed = 8 } = {}) {
  if (!Array.isArray(clips) || !clips.length) return null;
  const usable = clips.filter((clip) => clip?.isAnimationClip || clip instanceof THREE6.AnimationClip);
  const find = (patterns) => {
    for (const pattern of patterns) {
      const clip = usable.find((c) => pattern.test(c.name) && !/crouch/i.test(c.name));
      if (clip) return clip;
    }
    return null;
  };
  const mixer = new THREE6.AnimationMixer(root), actions = {};
  for (const [state2, patterns] of Object.entries(LOCOMOTION)) {
    const clip = find(patterns);
    if (clip) actions[state2] = mixer.clipAction(clip);
  }
  actions.walk ??= actions.run;
  actions.run ??= actions.walk;
  if (!actions.idle && !actions.walk) return null;
  let current = null, state = null, airborne = 0, played = null;
  const fadeTo = (next, name) => {
    state = name;
    if (next === current) return;
    next.reset().setEffectiveWeight(1).fadeIn(FADE).play();
    current?.fadeOut(FADE);
    current = next;
  };
  mixer.addEventListener("finished", (event) => {
    if (event.action !== played) return;
    played = null;
    current = null;
    event.action.fadeOut(FADE);
  });
  return {
    mixer,
    get state() {
      return played ? played.getClip().name : state;
    },
    setSpeeds(walk, run) {
      speed = walk;
      runSpeed = run;
    },
    /** Play a clip by name, once or with `loop` until stop(), then return to movement. Returns its duration, or null. */
    play(name, { fade = FADE, loop = false } = {}) {
      const clip = usable.find((c) => c.name === name) ?? usable.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
      if (!clip) return null;
      const action = mixer.clipAction(clip);
      action.reset().setLoop(loop ? THREE6.LoopRepeat : THREE6.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      action.fadeIn(fade).play();
      if (current && current !== action) current.fadeOut(fade);
      current = action;
      played = action;
      return clip.duration;
    },
    stop() {
      if (!played) return;
      played.fadeOut(FADE);
      played = null;
      current = null;
    },
    update(dt, { horizontalSpeed, grounded }) {
      airborne = grounded ? 0 : airborne + dt;
      if (!played) {
        const walk = horizontalSpeed > 0.2 && horizontalSpeed <= (speed + runSpeed) / 2;
        const next = airborne > AIR_DELAY && actions.air ? "air" : horizontalSpeed <= 0.2 ? "idle" : walk ? "walk" : "run";
        fadeTo(actions[next] ?? actions.walk ?? actions.idle, next);
        if ((next === "walk" || next === "run") && actions.walk) {
          const base = next === "walk" ? speed : runSpeed;
          current.timeScale = THREE6.MathUtils.clamp(horizontalSpeed / base, 0.6, 1.4);
        } else current.timeScale = next === "idle" && !actions.idle ? 0 : 1;
      }
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    }
  };
}

// src/touchControls.js
function touchAvailable(win) {
  return !!win && ("ontouchstart" in win || win.navigator?.maxTouchPoints > 0);
}
function finePointer(win) {
  return !!win?.matchMedia?.("(any-pointer: fine)")?.matches;
}
var DEAD_ZONE = 0.12;
function createTouchControls({ canvas, player, jump = true, buttons = [], lookScale = 1.5, radius = 52 }) {
  const doc = canvas.ownerDocument;
  const el = (style, parent) => {
    const node = doc.createElement("div");
    Object.assign(node.style, style);
    parent?.append(node);
    return node;
  };
  const root = el({ position: "fixed", zIndex: "50", display: "none", pointerEvents: "none", userSelect: "none", webkitUserSelect: "none" });
  root.dataset.rosebloxTouch = "";
  const ring = el({
    position: "absolute",
    display: "none",
    width: `${radius * 2}px`,
    height: `${radius * 2}px`,
    marginLeft: `${-radius}px`,
    marginTop: `${-radius}px`,
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,.45)",
    background: "rgba(255,255,255,.12)",
    pointerEvents: "none"
  }, root);
  ring.dataset.rosebloxTouch = "stick";
  const knob = el({
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "48px",
    height: "48px",
    marginLeft: "-24px",
    marginTop: "-24px",
    borderRadius: "50%",
    background: "rgba(255,255,255,.55)"
  }, ring);
  const column = el({ position: "absolute", right: "20px", bottom: "24px", display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: "14px", pointerEvents: "none" }, root);
  let move = null, look = null, shown = false, bodyTouchAction = null, disposed = false;
  const endMove = () => {
    move = null;
    ring.style.display = "none";
    knob.style.transform = "";
    player.setAxis(0, 0);
  };
  const endLook = () => {
    look = null;
  };
  const interactive = (target) => target?.closest?.("button, a, input, select, textarea, label, [role=button], [contenteditable=true], [data-roseblox-touch=button]");
  const stickDrag = (event) => event.pointerType === "touch" || event.pointerType === "pen";
  function down(event) {
    if (!shown || !stickDrag(event) || interactive(event.target)) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    const left = x < rect.width / 2;
    if (left ? move : look) return;
    event.preventDefault();
    event.stopPropagation();
    if (left) {
      move = { id: event.pointerId, x: event.clientX, y: event.clientY };
      Object.assign(ring.style, { display: "block", left: `${x}px`, top: `${y}px` });
    } else look = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function drag(event) {
    if (move?.id === event.pointerId) {
      event.preventDefault();
      let dx = event.clientX - move.x, dy = event.clientY - move.y;
      const length = Math.hypot(dx, dy);
      if (length > radius) {
        dx *= radius / length;
        dy *= radius / length;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const x = dx / radius, z = dy / radius;
      if (Math.hypot(x, z) < DEAD_ZONE) player.setAxis(0, 0);
      else player.setAxis(x, z);
    } else if (look?.id === event.pointerId) {
      event.preventDefault();
      player.look((event.clientX - look.x) * lookScale, (event.clientY - look.y) * lookScale);
      look.x = event.clientX;
      look.y = event.clientY;
    }
  }
  function up3(event) {
    if (move?.id === event.pointerId) endMove();
    if (look?.id === event.pointerId) endLook();
  }
  const listeners = [["pointerdown", down], ["pointermove", drag], ["pointerup", up3], ["pointercancel", up3]];
  for (const [type, handler] of listeners) doc.addEventListener(type, handler, { capture: true, passive: false });
  const held = /* @__PURE__ */ new Map();
  function addButton({ label, action, onPress, onRelease }) {
    if (!label || !action && !onPress) throw new Error("Touch buttons need a label and an action or onPress.");
    const button = el({
      width: "64px",
      height: "64px",
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: "2px solid rgba(255,255,255,.5)",
      background: "rgba(255,255,255,.18)",
      color: "#fff",
      font: "600 13px system-ui, sans-serif",
      textShadow: "0 1px 2px rgba(0,0,0,.6)",
      pointerEvents: "auto",
      touchAction: "none",
      cursor: "pointer"
    }, column);
    button.textContent = label;
    button.dataset.rosebloxTouch = "button";
    const release = () => {
      if (!held.has(button)) return;
      held.delete(button);
      button.style.background = "rgba(255,255,255,.18)";
      if (action) player.setAction(action, false);
      onRelease?.();
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        button.setPointerCapture?.(event.pointerId);
      } catch {
      }
      if (held.has(button)) return;
      held.set(button, release);
      button.style.background = "rgba(255,255,255,.4)";
      if (action) player.setAction(action, true);
      onPress?.();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, release);
    return button;
  }
  if (jump) addButton({ label: "Jump", action: "jump" });
  for (const config of buttons) addButton(config);
  function releaseAll() {
    endMove();
    endLook();
    for (const release of [...held.values()]) release();
  }
  doc.body.append(root);
  return {
    element: root,
    get visible() {
      return shown;
    },
    /** Follow the canvas and show controls only while the player is active. */
    sync() {
      const on = player.active;
      if (on !== shown) {
        shown = on;
        root.style.display = on ? "block" : "none";
        if (on) {
          bodyTouchAction = doc.body.style.touchAction;
          doc.body.style.touchAction = "none";
        } else {
          doc.body.style.touchAction = bodyTouchAction ?? "";
          releaseAll();
        }
      }
      if (!on) return;
      const rect = canvas.getBoundingClientRect();
      Object.assign(root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    },
    // Safe to call twice, as world.dispose() and player.remove() both do in either order.
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseAll();
      for (const [type, handler] of listeners) doc.removeEventListener(type, handler, { capture: true });
      if (shown) doc.body.style.touchAction = bodyTouchAction ?? "";
      root.remove();
    }
  };
}

// src/rpg.js
function positive2(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}
function feetVector(value = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error("feet must contain three finite numbers.");
  return new THREE7.Vector3(...value);
}
var standInGeometry;
var standInMaterial;
function standIn() {
  standInGeometry ??= new THREE7.CapsuleGeometry(0.2, 0.6, 4, 12);
  standInMaterial ??= new THREE7.MeshStandardMaterial({ color: 10134706, roughness: 0.7 });
  return new THREE7.Mesh(standInGeometry, standInMaterial);
}
function cloneModel(source) {
  const clone = source.clone(), copies = /* @__PURE__ */ new Map();
  const pair = (a, b) => {
    copies.set(a, b);
    a.children.forEach((child, i) => pair(child, b.children[i]));
  };
  pair(source, clone);
  for (const [original, copy] of copies) {
    if (!original.isSkinnedMesh) continue;
    copy.bind(new THREE7.Skeleton(original.skeleton.bones.map((bone) => copies.get(bone) ?? bone), original.skeleton.boneInverses), original.bindMatrix);
  }
  return clone;
}
function actorModel(source, root) {
  if (source == null) return standIn();
  return root?.isObject3D && root.parent ? cloneModel(root) : root;
}
function fitRpgModel(model, { height = 1.8, yaw = 0 } = {}) {
  positive2(height, "height");
  if (!model?.isObject3D || model.parent) throw new Error("Pass a detached Three.js model instance.");
  if (!Number.isFinite(yaw)) throw new Error("yaw must be finite.");
  model.updateWorldMatrix(true, true);
  const bounds = new THREE7.Box3().setFromObject(model), size = bounds.getSize(new THREE7.Vector3());
  if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) throw new Error("Model needs nonempty, finite bounds.");
  const center = bounds.getCenter(new THREE7.Vector3());
  const root = new THREE7.Group(), correction = new THREE7.Group(), scaled = new THREE7.Group();
  root.add(correction);
  correction.add(scaled);
  scaled.add(model);
  model.position.sub(new THREE7.Vector3(center.x, bounds.min.y, center.z));
  scaled.scale.setScalar(height / size.y);
  correction.rotation.y = yaw;
  return root;
}
async function createRpgWorld({ playerDefaults = {}, ...options } = {}) {
  const mechanics = await createMechanics({ ...options, gravity: options.gravity ?? [0, RPG_MOVEMENT_DEFAULTS.gravity, 0] });
  const overlays = /* @__PURE__ */ new Set(), animated = /* @__PURE__ */ new Map();
  function prepareActor(model, feet, height, radius, modelYaw) {
    positive2(height, "height");
    positive2(radius, "radius");
    if (height < 2 * radius) throw new Error("Actor height must be at least twice its radius.");
    const spawn = feetVector(feet).add(new THREE7.Vector3(0, height / 2, 0));
    const visual = fitRpgModel(model, { height, yaw: modelYaw });
    return { spawn, visual };
  }
  function animateActor(actor, body, parts, enabled, speeds) {
    const locomotion = enabled ? createLocomotion(parts.root, parts.clips, speeds) : null;
    if (locomotion) animated.set(actor, { locomotion, body });
    const remove = actor.remove;
    Object.defineProperties(actor, {
      mixer: { get: () => locomotion?.mixer ?? null },
      animation: { get: () => locomotion?.state ?? null }
    });
    return Object.assign(actor, {
      playAnimation: (name, options2) => locomotion?.play(name, options2) ?? null,
      stopAnimation: () => locomotion?.stop(),
      remove: () => {
        if (animated.delete(actor)) locomotion.dispose();
        remove();
      }
    });
  }
  function attachActor(body, visual, height, forwardAxis = "+Z") {
    const root = new THREE7.Group(), axis = new THREE7.Vector3(0, 0, forwardAxis === "+Z" ? 1 : -1);
    visual.position.y = -height / 2;
    root.add(visual);
    body.bindObject(root);
    return {
      body,
      root,
      visual,
      get position() {
        return readable(body.position.add(new THREE7.Vector3(0, -height / 2, 0)));
      },
      /** Horizontal facing, independent of each controller's body axis. */
      get forward() {
        const v = axis.clone().applyQuaternion(body.quaternion);
        v.y = 0;
        return readable(v.lengthSq() ? v.normalize() : new THREE7.Vector3(0, 0, -1));
      },
      get grounded() {
        return body.grounded;
      },
      jump: () => body.jump(),
      teleport: (feet) => body.teleport(feetVector(feet).add(new THREE7.Vector3(0, height / 2, 0))),
      remove: () => {
        body.remove();
        root.removeFromParent();
      }
    };
  }
  async function addPlayer(config) {
    const { model: source, animations, animate = true, feet = [0, 0, 0], height = 1.8, radius = 0.35, modelYaw = 0, view = "third", touch = "auto", touchButtons = [], ...controls } = { ...playerDefaults, ...config };
    const parts = modelParts(source, animations), model = parts.root = actorModel(source, parts.root);
    if (!["third", "first"].includes(view)) throw new Error("view must be third or first.");
    if (!["auto", true, false].includes(touch)) throw new Error("touch must be auto, true or false.");
    if (!Array.isArray(touchButtons)) throw new Error("touchButtons must be an array.");
    const win = controls.canvas?.ownerDocument?.defaultView;
    const useTouch = touch === "auto" ? touchAvailable(win) : touch;
    const lockPointer = !useTouch || finePointer(win);
    const jumpSpeed = controls.jumpSpeed ?? RPG_MOVEMENT_DEFAULTS.jumpSpeed;
    const { spawn, visual } = prepareActor(model, feet, height, radius, modelYaw);
    let body;
    try {
      if (view === "first") body = await mechanics.addFpsPlayer({
        camera: controls.camera,
        canvas: controls.canvas,
        position: spawn.toArray(),
        radius,
        height: height - 2 * radius,
        speed: controls.speed,
        runSpeed: controls.runSpeed,
        jumpSpeed,
        lockPointer,
        eyeOffset: [0, height * 0.42, 0],
        yaw: controls.yaw ?? 0,
        pitch: controls.pitch ?? 0,
        sensitivity: controls.sensitivity,
        onFire: controls.onAttack
      });
      else body = await mechanics.addThirdPersonPlayer({
        ...controls,
        position: spawn.toArray(),
        radius,
        height: height - 2 * radius,
        forwardAxis: "+Z",
        controlMode: controls.controlMode ?? "mmo",
        lockPointer,
        jumpSpeed,
        facing: controls.facing ?? "camera",
        targetOffset: controls.targetOffset ?? [0, height * 0.3, 0]
      });
    } catch (error) {
      model.removeFromParent();
      throw error;
    }
    const actor = attachActor(body, visual, height, view === "first" ? "-Z" : "+Z");
    if (view === "first") visual.visible = false;
    let overlay = null;
    try {
      if (useTouch) overlay = createTouchControls({ canvas: controls.canvas, player: body, jump: jumpSpeed > 0, buttons: touchButtons });
    } catch (error) {
      actor.remove();
      throw error;
    }
    if (overlay) overlays.add(overlay);
    const remove = actor.remove;
    Object.defineProperties(actor, {
      velocity: { get: () => body.velocity },
      jumpPressed: { get: () => body.jumpPressed },
      jumpHeld: { get: () => body.jumpHeld },
      active: { get: () => body.active },
      locked: { get: () => body.locked },
      touch: { value: !!overlay }
    });
    const speeds = { speed: controls.speed ?? 5, runSpeed: controls.runSpeed ?? 8 };
    animateActor(actor, body, parts, animate && view !== "first", speeds);
    const removeAnimated = actor.remove;
    return Object.assign(actor, {
      remove: () => {
        if (overlay) {
          overlays.delete(overlay);
          overlay.dispose();
          overlay = null;
        }
        removeAnimated();
      },
      look: (dx, dy) => body.look(dx, dy),
      setAxis: (x, z) => body.setAxis(x, z),
      start: () => body.start(),
      stop: () => body.stop(),
      pause: () => body.pause(),
      resume: () => body.resume(),
      setAction: (name, down) => body.setAction(name, down),
      setMoveSpeed: (walk, run = walk) => {
        body.setMoveSpeed(walk, run);
        animated.get(actor)?.locomotion.setSpeeds(walk, run);
      },
      setVelocity: (value) => body.setMotion(value)
    });
  }
  function addNpc({ model: source, animations, animate = true, speed = 2.5, runSpeed = 5, feet = [0, 0, 0], height = 1.8, radius = 0.35, modelYaw = 0, autoFaceMovement = true, ...config }) {
    const parts = modelParts(source, animations), model = parts.root = actorModel(source, parts.root);
    const { spawn, visual } = prepareActor(model, feet, height, radius, modelYaw);
    let body;
    try {
      body = mechanics.addCharacter({ ...config, position: spawn.toArray(), radius, height: height - 2 * radius, forwardAxis: "+Z", autoFaceMovement });
    } catch (error) {
      model.removeFromParent();
      throw error;
    }
    const npc = Object.assign(attachActor(body, visual, height), {
      setVelocity: (value) => body.setVelocity(value),
      faceDirection: (value) => body.faceDirection(value)
    });
    return animateActor(npc, body, parts, animate, { speed, runSpeed });
  }
  return {
    addPlayer,
    addNpc,
    addBody: mechanics.addBody,
    addCharacter: mechanics.addCharacter,
    addStaticMesh: mechanics.addStaticMesh,
    castRay: mechanics.castRay,
    castSegment: mechanics.castSegment,
    onCollision: mechanics.onCollision,
    advance(dt, config) {
      const result = mechanics.advance(dt, config);
      for (const overlay of overlays) overlay.sync();
      if (!config?.paused && dt > 0) for (const [actor, { locomotion, body }] of animated) {
        if (body.removed) {
          animated.delete(actor);
          locomotion.dispose();
          continue;
        }
        const v = body.velocity;
        locomotion.update(Math.min(dt, 0.1), { horizontalSpeed: Math.hypot(v.x, v.z), grounded: body.grounded });
      }
      return result;
    },
    getDiagnostics: mechanics.getDiagnostics,
    dispose() {
      for (const overlay of overlays) overlay.dispose();
      overlays.clear();
      for (const { locomotion } of animated.values()) locomotion.dispose();
      animated.clear();
      mechanics.dispose();
    }
  };
}

// src/controls.js
function createWorld({ playerDefaults, ...options } = {}) {
  return createRpgWorld({ ...options, playerDefaults: { controlMode: "pointer", facing: "movement", ...playerDefaults } });
}
export {
  createWorld,
  fitRpgModel as fitModel
};
