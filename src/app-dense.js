import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

class App {
  constructor() {
    // Core objects
    this.scene = null; this.camera = null; this.renderer = null; this.controls = null;
    // Simulation state
    this.meteors = []; this.impactEffects = []; this.labels = []; this.gravityVisualizers = [];
    this.explosionEffects = []; this.trajectoryLines = []; this.orbitalObjects = []; this.orbitalTrails = [];
    this.tsunamiZones = []; this.earthquakeEffects = []; this.mapMarkers = []; this.mapCircles = [];
    // UI/state
    this.simSpeed = 1; this.realistic = false; this.paused = false; this.impactCount = 0;
    this.showAiming = true; this.showAtmosphere = true; this.showMoon = true; this.showGravityViz = false;
    this.enableExplosions = true; this.lastMeteorData = null; this.cameraFocus = 'free';
    this.focusedMeteor = null; this.simulationStartTime = Date.now(); this.lastUpdateTime = Date.now();
    // Statistics
    this.totalImpactEnergy = 0; this.largestImpactEnergy = 0; this.frameCount = 0;
    this.lastFpsTime = Date.now(); this.currentFps = 60; this.impactLocations = [];
    // Map
    this.mapCanvas = null; this.mapCtx = null; this.leafletMap = null; this.mapExpanded = false; this.leafletReady = false;
    // Physics constants
    this.G = 6.67430e-11; this.earthMass = 5.972e24; this.earthRadiusMeters = 6371000;
    this.SCENE_SCALE = 1e5; this.earthRadius = this.earthRadiusMeters / this.SCENE_SCALE; this.gravityStrength = 2.0;
    // Moon
    this.moonMass = 7.342e22; this.moonRadiusMeters = 1737400; this.moonRadius = this.moonRadiusMeters / this.SCENE_SCALE;
    this.moonDistance = 384400000 / this.SCENE_SCALE; this.moonOrbitalSpeed = 1022 / this.SCENE_SCALE; this.moonAngle = 0;
    // Earth-Moon system
    this.earthMoonSystem = {
      earth: { name: 'Earth', mass: 5.972e24, radius: 6371000, position: new THREE.Vector3(0, 0, 0), color: 0x6b93d6 },
      moon: { name: 'Moon', mass: 7.342e22, radius: 1737400, distance: 384400000 / this.SCENE_SCALE, orbitalSpeed: 0.000001, angle: 0, color: 0xcccccc }
    };
    // Atmosphere
    this.atmosphereHeight = 500000; this.atmosphereHeightScene = this.atmosphereHeight / this.SCENE_SCALE;
    this.atmosphereDensity = 1.225; this.dragCoefficient = 0.47; this.burnTemperature = 1500; this.burnSpeedThreshold = 2000;
    this.seaLevelPressure = 101325; this.gasConstant = 287; this.standardTemperature = 288;
    this.atmosphereLayers = [
      { name: 'Troposphere', height: 12000, density: 1.225, temperature: 288, windSpeed: 10 },
      { name: 'Stratosphere', height: 50000, density: 0.088, temperature: 216, windSpeed: 50 },
      { name: 'Mesosphere', height: 80000, density: 0.001, temperature: 190, windSpeed: 100 },
      { name: 'Thermosphere', height: 200000, density: 0.0001, temperature: 1000, windSpeed: 200 },
      { name: 'Exosphere', height: 500000, density: 0.00001, temperature: 1500, windSpeed: 300 }
    ];
    this.windDirection = new THREE.Vector3(1, 0, 0); this.windStrength = 0.1;
    this.mouse = new THREE.Vector2(); this.raycaster = new THREE.Raycaster();
    this.cursor = null; this.predictedImpactMarker = null; this.cameraFrame = { active: false };
    this.keplerTolerance = 1.0e-14;
  }

  frameCameraTo(targetPos, endCamPos, durationMs = 1200) {
    this.cameraFrame = { active: true, startTime: Date.now(), duration: durationMs, startCamPos: this.camera.position.clone(), endCamPos: endCamPos.clone(), startTarget: this.controls.target.clone(), endTarget: targetPos.clone() };
  }

  createLabel(text, position) {
    const div = document.createElement('div');
    div.className = 'label'; div.style.position = 'absolute'; div.style.color = 'white'; div.style.fontSize = '14px'; div.innerText = text;
    document.body.appendChild(div); const label = { element: div, position }; this.labels.push(label); return label;
  }

  updateLabels() {
    this.labels.forEach(label => {
      const vector = label.position.clone(); vector.project(this.camera);
      const x = (vector.x * 0.5 + 0.5) * window.innerWidth; const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
      label.element.style.left = `${x}px`; label.element.style.top = `${y}px`;
    });
  }

  init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
    this.camera.position.set(0, 3, 15); this.scene.add(this.camera);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputEncoding = THREE.sRGBEncoding; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    document.body.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Earth
    const earthGeo = new THREE.SphereGeometry(this.earthRadius, 32, 32);
    const earthMat = new THREE.MeshPhongMaterial({ color: 0x2233ff });
    const earth = new THREE.Mesh(earthGeo, earthMat); this.scene.add(earth);
    this.createLabel('Earth', new THREE.Vector3(0, this.earthRadius + 0.2, 0));

    // Atmosphere
    const atmosphereGeo = new THREE.SphereGeometry(this.earthRadius + this.atmosphereHeightScene, 32, 32);
    const atmosphereMat = new THREE.MeshBasicMaterial({ color: 0x87CEEB, transparent: true, opacity: 0.1 });
    const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat); this.scene.add(atmosphere);

    // Moon
    if (this.showMoon) {
      const moonGeo = new THREE.SphereGeometry(this.moonRadius, 16, 16);
      const moonMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
      const moon = new THREE.Mesh(moonGeo, moonMat);
      moon.position.set(this.moonDistance, 0, 0); this.scene.add(moon);
      this.createLabel('Moon', new THREE.Vector3(this.moonDistance, this.moonRadius + 0.1, 0));
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4); this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); directionalLight.position.set(5, 5, 5); this.scene.add(directionalLight);

    // Event listeners
    window.addEventListener('resize', () => this.onWindowResize());
    window.addEventListener('click', (event) => this.onMouseClick(event));
    window.addEventListener('keydown', (event) => this.onKeyDown(event));

    this.setupUI();
    this.loadHighResEarthTexture();
  }

  setupUI() {
    const ui = document.createElement('div');
    ui.innerHTML = `
      <div style="position: fixed; top: 10px; left: 10px; background: rgba(0,0,0,0.7); color: white; padding: 10px; border-radius: 5px; font-family: monospace;">
        <div>Speed: <input type="range" id="speed" min="0.1" max="5" step="0.1" value="1" style="width: 100px;"></div>
        <div>Realistic: <input type="checkbox" id="realistic"></div>
        <div>Pause: <input type="checkbox" id="pause"></div>
        <div>Show Atmosphere: <input type="checkbox" id="atmosphere" checked></div>
        <div>Show Moon: <input type="checkbox" id="moon" checked></div>
        <div>Explosions: <input type="checkbox" id="explosions" checked></div>
        <div>Impacts: <span id="impactCount">0</span></div>
        <div>FPS: <span id="fps">60</span></div>
        <div>Energy: <span id="energy">0</span> J</div>
        <div>Density: <span id="density">1.225</span> kg/m³</div>
        <div>Pressure: <span id="pressure">101325</span> Pa</div>
        <div>Temperature: <span id="temperature">288</span> K</div>
        <button onclick="app.spawnMeteor()">Spawn Meteor</button>
        <button onclick="app.loadHighResEarthTexture()">Load Earth Texture</button>
      </div>
    `;
    document.body.appendChild(ui);

    // Event listeners for UI
    document.getElementById('speed').addEventListener('input', (e) => { this.simSpeed = parseFloat(e.target.value); });
    document.getElementById('realistic').addEventListener('change', (e) => { this.realistic = e.target.checked; });
    document.getElementById('pause').addEventListener('change', (e) => { this.paused = e.target.checked; });
    document.getElementById('atmosphere').addEventListener('change', (e) => { this.showAtmosphere = e.target.checked; this.updateAtmosphereVisibility(); });
    document.getElementById('moon').addEventListener('change', (e) => { this.showMoon = e.target.checked; this.updateMoonVisibility(); });
    document.getElementById('explosions').addEventListener('change', (e) => { this.enableExplosions = e.target.checked; });
  }

  updateAtmosphereVisibility() {
    const atmosphere = this.scene.children.find(c => c.material && c.material.transparent);
    if (atmosphere) atmosphere.visible = this.showAtmosphere;
  }

  updateMoonVisibility() {
    const moon = this.scene.children.find(c => c.material && c.material.color && c.material.color.getHex() === 0xcccccc);
    if (moon) moon.visible = this.showMoon;
  }

  onWindowResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  onMouseClick(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children);
    if (intersects.length > 0) this.spawnMeteor();
  }

  onKeyDown(event) {
    switch (event.key) {
      case ' ': event.preventDefault(); this.paused = !this.paused; break;
      case 'r': this.realistic = !this.realistic; break;
      case 'm': this.spawnMeteor(); break;
      case 'c': this.clearAll(); break;
    }
  }

  spawnMeteor() {
    const angle = Math.random() * Math.PI * 2;
    const distance = 20 + Math.random() * 30;
    const height = 5 + Math.random() * 10;
    const position = new THREE.Vector3(
      Math.cos(angle) * distance,
      height,
      Math.sin(angle) * distance
    );

    const velocity = new THREE.Vector3(
      -Math.cos(angle) * (2 + Math.random() * 3),
      -Math.random() * 2,
      -Math.sin(angle) * (2 + Math.random() * 3)
    );

    const size = 0.1 + Math.random() * 0.3;
    const mass = Math.pow(size, 3) * 3000; // kg/m³ density
    const color = new THREE.Color().setHSL(0.1 + Math.random() * 0.2, 0.8, 0.5);

    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color });
    const meteor = new THREE.Mesh(geometry, material);
    meteor.position.copy(position); this.scene.add(meteor);

    const label = this.createLabel(`Meteor ${this.meteors.length + 1}`, position);

    const meteorData = {
      mesh: meteor, position, velocity, mass, size, color, burning: false, burnIntensity: 0,
      label, asteroidData: null, entrySpeed: velocity.length() * 1000, energy: 0.5 * mass * Math.pow(velocity.length() * 1000, 2)
    };

    this.meteors.push(meteorData);
    this.lastMeteorData = meteorData;
    this.createTrajectoryLine(meteorData);
  }

  createTrajectoryLine(meteorData) {
    const points = [meteorData.position.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.7 });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line); this.trajectoryLines.push({ line, meteor: meteorData, points });
  }

  updateTrajectoryLines() {
    this.trajectoryLines.forEach(tl => {
      tl.points.push(tl.meteor.position.clone());
      if (tl.points.length > 100) tl.points.shift();
      tl.line.geometry.setFromPoints(tl.points);
    });
  }

  updatePhysics() {
    if (this.paused) return;

    this.meteors.forEach(meteor => {
      // Gravity
      const earthPos = new THREE.Vector3(0, 0, 0);
      const direction = earthPos.clone().sub(meteor.position).normalize();
      const distance = meteor.position.length();
      const gravityForce = (this.G * this.earthMass * meteor.mass) / Math.pow(distance * this.SCENE_SCALE, 2);
      const acceleration = direction.multiplyScalar(gravityForce / meteor.mass);
      meteor.velocity.add(acceleration.multiplyScalar(this.simSpeed * 0.016));

      // Atmosphere drag with realistic density calculations
      if (distance < this.earthRadius + this.atmosphereHeightScene) {
        const height = (distance - this.earthRadius) * this.SCENE_SCALE;
        const density = this.getAtmosphereDensity(height);
        const pressure = this.getAtmospherePressure(height);
        const temperature = this.getAtmosphereTemperature(height);
        
        // Dynamic drag coefficient based on speed and density
        const speed = meteor.velocity.length() * this.SCENE_SCALE;
        const machNumber = speed / 343; // Speed of sound
        const dynamicDragCoeff = this.dragCoefficient * (1 + machNumber * 0.1);
        
        // Reynolds number for more accurate drag
        const reynoldsNumber = (density * speed * meteor.size * 2) / (1.8e-5); // Dynamic viscosity of air
        const correctedDragCoeff = dynamicDragCoeff * (1 + 0.1 * Math.log(reynoldsNumber + 1));
        
        const dragForce = 0.5 * density * Math.pow(speed, 2) * correctedDragCoeff * Math.PI * Math.pow(meteor.size, 2);
        const dragAcceleration = meteor.velocity.clone().normalize().multiplyScalar(-dragForce / meteor.mass);
        meteor.velocity.add(dragAcceleration.multiplyScalar(this.simSpeed * 0.016));

        // Enhanced burning effect based on density and temperature
        if (speed > this.burnSpeedThreshold) {
          meteor.burning = true;
          const heatTransfer = density * Math.pow(speed, 3) / 1000000; // Heat transfer rate
          meteor.burnIntensity = Math.min(1, heatTransfer / 1000);
          
          // Color based on temperature and density
          const tempFactor = Math.min(1, temperature / 2000);
          const densityFactor = Math.min(1, density / 1.225);
          meteor.material.color.setHSL(0.1 + tempFactor * 0.3, 1, 0.2 + meteor.burnIntensity * 0.8);
        }
      }

      // Update position
      meteor.position.add(meteor.velocity.clone().multiplyScalar(this.simSpeed * 0.016));
      meteor.mesh.position.copy(meteor.position);

      // Check for impact
      if (distance < this.earthRadius + meteor.size) {
        this.handleImpact(meteor);
      }
    });

    this.updateTrajectoryLines();
    this.updateLabels();
  }

  getAtmosphereDensity(height) {
    // Exponential density decay with altitude
    if (height < 0) return this.atmosphereLayers[0].density;
    if (height > this.atmosphereHeight) return 0;
    
    // Barometric formula: ρ = ρ₀ * exp(-h/H)
    const scaleHeight = 8400; // meters
    const density = this.atmosphereLayers[0].density * Math.exp(-height / scaleHeight);
    
    // Layer-based adjustments
    for (let i = this.atmosphereLayers.length - 1; i >= 0; i--) {
      if (height >= this.atmosphereLayers[i].height) {
        return Math.max(density, this.atmosphereLayers[i].density);
      }
    }
    return density;
  }

  getAtmospherePressure(height) {
    if (height < 0) return this.seaLevelPressure;
    if (height > this.atmosphereHeight) return 0;
    
    // Barometric formula: P = P₀ * exp(-h/H)
    const scaleHeight = 8400;
    return this.seaLevelPressure * Math.exp(-height / scaleHeight);
  }

  getAtmosphereTemperature(height) {
    if (height < 0) return this.standardTemperature;
    if (height > this.atmosphereHeight) return 1500;
    
    // Temperature profile by atmospheric layer
    for (let i = this.atmosphereLayers.length - 1; i >= 0; i--) {
      if (height >= this.atmosphereLayers[i].height) {
        return this.atmosphereLayers[i].temperature;
      }
    }
    return this.standardTemperature;
  }

  handleImpact(meteor) {
    const energy = 0.5 * meteor.mass * Math.pow(meteor.velocity.length() * this.SCENE_SCALE, 2);
    this.totalImpactEnergy += energy; this.largestImpactEnergy = Math.max(this.largestImpactEnergy, energy); this.impactCount++;

    // Create impact effect
    if (this.enableExplosions) {
      this.createExplosion(meteor.position, energy);
    }

    // Update UI
    document.getElementById('impactCount').textContent = this.impactCount;
    document.getElementById('energy').textContent = Math.round(this.totalImpactEnergy / 1e12) + 'T';

    // Remove meteor
    this.scene.remove(meteor.mesh); this.scene.remove(meteor.label.element);
    const index = this.meteors.indexOf(meteor); if (index > -1) this.meteors.splice(index, 1);

    // Remove trajectory
    const tlIndex = this.trajectoryLines.findIndex(tl => tl.meteor === meteor);
    if (tlIndex > -1) { this.scene.remove(this.trajectoryLines[tlIndex].line); this.trajectoryLines.splice(tlIndex, 1); }
  }

  createExplosion(position, energy) {
    const particleCount = Math.min(100, Math.floor(energy / 1e12));
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = position.x + (Math.random() - 0.5) * 2;
      positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 2;
      positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 2;

      const color = new THREE.Color().setHSL(0.1 + Math.random() * 0.2, 1, 0.5);
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({ size: 0.1, vertexColors: true, transparent: true, opacity: 0.8 });
    const explosion = new THREE.Points(geometry, material);
    this.scene.add(explosion); this.explosionEffects.push({ mesh: explosion, life: 1.0 });

    // Remove explosion after 2 seconds
    setTimeout(() => { this.scene.remove(explosion); this.explosionEffects = this.explosionEffects.filter(e => e.mesh !== explosion); }, 2000);
  }

  updateExplosions() {
    this.explosionEffects.forEach(effect => {
      effect.life -= 0.016; effect.mesh.material.opacity = effect.life;
      if (effect.life <= 0) { this.scene.remove(effect.mesh); }
    });
    this.explosionEffects = this.explosionEffects.filter(e => e.life > 0);
  }

  clearAll() {
    this.meteors.forEach(meteor => { this.scene.remove(meteor.mesh); this.scene.remove(meteor.label.element); });
    this.trajectoryLines.forEach(tl => this.scene.remove(tl.line));
    this.explosionEffects.forEach(e => this.scene.remove(e.mesh));
    this.meteors = []; this.trajectoryLines = []; this.explosionEffects = [];
    this.impactCount = 0; this.totalImpactEnergy = 0; this.largestImpactEnergy = 0;
    document.getElementById('impactCount').textContent = '0'; document.getElementById('energy').textContent = '0';
    document.getElementById('density').textContent = '1.225'; document.getElementById('pressure').textContent = '101325'; document.getElementById('temperature').textContent = '288';
  }

  updateStats() {
    this.frameCount++;
    const now = Date.now();
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime));
      this.frameCount = 0; this.lastFpsTime = now;
      document.getElementById('fps').textContent = this.currentFps;
    }
    
    // Update atmospheric data for the first meteor if exists
    if (this.meteors.length > 0) {
      const meteor = this.meteors[0];
      const distance = meteor.position.length();
      if (distance < this.earthRadius + this.atmosphereHeightScene) {
        const height = (distance - this.earthRadius) * this.SCENE_SCALE;
        const density = this.getAtmosphereDensity(height);
        const pressure = this.getAtmospherePressure(height);
        const temperature = this.getAtmosphereTemperature(height);
        
        document.getElementById('density').textContent = density.toFixed(6);
        document.getElementById('pressure').textContent = Math.round(pressure);
        document.getElementById('temperature').textContent = Math.round(temperature);
      }
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.updatePhysics(); this.updateExplosions(); this.updateStats();
    this.renderer.render(this.scene, this.camera);
  }

  loadHighResEarthTexture() {
    const userUrl = window.prompt('Enter a USGS or remote Earth texture URL (leave blank to use defaults):', '');
    const urls = [];
    if (userUrl && userUrl.trim()) urls.push(userUrl.trim());
    urls.push('https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2012044_lrg.jpg');
    urls.push('https://upload.wikimedia.org/wikipedia/commons/8/80/World_map_-_low_resolution.svg');
    const loader = new THREE.TextureLoader();
    let tried = 0;
    const tryLoad = () => {
      if (tried >= urls.length) return alert('All texture loads failed (CORS or network)');
      const url = urls[tried++];
      loader.load(url, tex => {
        const earth = this.scene.children.find(c => c.geometry && c.geometry.type === 'SphereGeometry');
        if (earth && earth.material) {
          if (earth.material.color) earth.material.color.setHex(0xffffff);
          tex.encoding = THREE.sRGBEncoding; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
          earth.material.map = tex; earth.material.needsUpdate = true;
        }
      }, undefined, err => { console.warn('Texture load failed', url, err); tryLoad(); });
    };
    tryLoad();
  }
}

const app = new App();
app.init();
app.animate();
window.app = app;
