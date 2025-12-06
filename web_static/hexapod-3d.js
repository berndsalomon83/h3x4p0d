(function(global) {
  const DEFAULT_GEOMETRY = {
    body_length: 300,
    body_width: 250,
    body_height_geo: 50,
    leg_coxa_length: 40,
    leg_femur_length: 80,
    leg_tibia_length: 100,
    leg_attach_points: [
      { x: 150, y: 120, z: 0, angle: 45 },
      { x: 0, y: 150, z: 0, angle: 90 },
      { x: -150, y: 120, z: 0, angle: 135 },
      { x: -150, y: -120, z: 0, angle: 225 },
      { x: 0, y: -150, z: 0, angle: 270 },
      { x: 150, y: -120, z: 0, angle: 315 }
    ]
  };

  const DEFAULT_MATERIALS = (THREE) => ({
    bodyMaterial: new THREE.MeshLambertMaterial({ color: 0x2d3b5a }),
    legMaterial: new THREE.MeshLambertMaterial({ color: 0x44dd88 }),
    jointMaterial: new THREE.MeshLambertMaterial({ color: 0x666666 }),
    footMaterial: new THREE.MeshLambertMaterial({ color: 0x333333 }),
    contactMaterial: new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    })
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function computeGroundingAngles(bodyHeight, legGeometry, groundY) {
    const femur = legGeometry.leg_femur_length;
    const tibia = legGeometry.leg_tibia_length;
    const target = Math.max(20, bodyHeight - groundY);
    const reach = clamp(target, 10, femur + tibia - 5);
    const cosKnee = clamp((femur ** 2 + tibia ** 2 - reach ** 2) / (2 * femur * tibia), -1, 1);
    const kneeAngle = Math.acos(cosKnee);
    const cosHip = clamp((femur ** 2 + reach ** 2 - tibia ** 2) / (2 * femur * reach), -1, 1);
    const hipAngle = Math.PI / 2 - Math.acos(cosHip);
    return {
      femur: hipAngle * -1,
      tibia: -(Math.PI - kneeAngle)
    };
  }

  function createBody(THREE, geometry, materials, bodyHeight) {
    const bodyGeometry = new THREE.BoxGeometry(
      geometry.body_width,
      geometry.body_height_geo,
      geometry.body_length
    );
    const bodyMesh = new THREE.Mesh(bodyGeometry, materials.bodyMaterial);
    bodyMesh.position.y = bodyHeight;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    return bodyMesh;
  }

  function createLeg(THREE, attachPoint, geometry, materials, bodyHeight, groundY, defaultPose) {
    const coxaLen = geometry.leg_coxa_length;
    const femurLen = geometry.leg_femur_length;
    const tibiaLen = geometry.leg_tibia_length;

    const legGroup = new THREE.Group();

    const coxaJoint = new THREE.Group();
    const coxaMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 4, coxaLen, 12),
      materials.legMaterial
    );
    coxaMesh.rotation.z = Math.PI / 2;
    coxaMesh.position.x = coxaLen / 2;
    coxaJoint.add(coxaMesh);

    const femurJoint = new THREE.Group();
    femurJoint.position.x = coxaLen;
    const femurMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, femurLen, 12),
      materials.legMaterial
    );
    femurMesh.position.y = -femurLen / 2;
    femurJoint.add(femurMesh);
    femurJoint.add(new THREE.Mesh(new THREE.SphereGeometry(5, 12, 12), materials.jointMaterial));

    const tibiaJoint = new THREE.Group();
    tibiaJoint.position.y = -femurLen;
    const tibiaMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, tibiaLen, 12),
      materials.legMaterial
    );
    tibiaMesh.position.y = -tibiaLen / 2;
    tibiaJoint.add(tibiaMesh);
    tibiaJoint.add(new THREE.Mesh(new THREE.SphereGeometry(4, 12, 12), materials.jointMaterial));

    const foot = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 12), materials.footMaterial.clone());
    foot.position.y = -tibiaLen;
    tibiaJoint.add(foot);

    femurJoint.add(tibiaJoint);
    coxaJoint.add(femurJoint);
    legGroup.add(coxaJoint);

    const posX = attachPoint.y;
    const posZ = attachPoint.x;
    const posY = bodyHeight + (attachPoint.z || 0);
    legGroup.position.set(posX, posY, posZ);
    legGroup.rotation.y = ((attachPoint.angle - 90) * Math.PI) / 180;

    if (defaultPose) {
      femurJoint.rotation.x = defaultPose.femur;
      tibiaJoint.rotation.x = defaultPose.tibia;
    }

    const contactIndicator = new THREE.Mesh(
      new THREE.RingGeometry(8, 12, 16),
      materials.contactMaterial.clone()
    );
    contactIndicator.rotation.x = -Math.PI / 2;
    contactIndicator.position.set(posX, groundY + 0.1, posZ);
    contactIndicator.visible = false;

    return {
      group: legGroup,
      coxaJoint,
      femurJoint,
      tibiaJoint,
      foot,
      contactIndicator,
      coxaMesh,
      femurMesh,
      tibiaMesh,
      isRightSide: attachPoint.y > 0
    };
  }

  function buildHexapod(options) {
    const { THREE, scene, geometry = {}, attachPoints, bodyHeight = 80, groundY = 0, materials: matOverrides = {}, defaultPose } = options;
    const geom = { ...DEFAULT_GEOMETRY, ...geometry };
    const materials = { ...DEFAULT_MATERIALS(THREE), ...matOverrides };
    const legs = [];
    const contactIndicators = [];

    const body = createBody(THREE, geom, materials, bodyHeight);
    scene.add(body);

    const poseAngles = defaultPose || computeGroundingAngles(bodyHeight, geom, groundY);

    (attachPoints || geom.leg_attach_points).forEach((attach, i) => {
      const leg = createLeg(THREE, attach, geom, materials, bodyHeight, groundY, poseAngles);
      scene.add(leg.group);
      scene.add(leg.contactIndicator);
      legs.push(leg);
      contactIndicators.push(leg.contactIndicator);
    });

    return {
      body,
      legs,
      contactIndicators,
      dispose() {
        scene.remove(body);
        body.geometry.dispose();
        legs.forEach((leg) => {
          scene.remove(leg.group);
          scene.remove(leg.contactIndicator);
          leg.group.traverse((child) => child.geometry && child.geometry.dispose());
          if (leg.contactIndicator.geometry) leg.contactIndicator.geometry.dispose();
        });
      }
    };
  }

  global.Hexapod3D = {
    buildHexapod,
    computeGroundingAngles
  };
})(window);
