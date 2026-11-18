import type { VRM, VRMHumanoid } from '@pixiv/three-vrm'
import { Euler, Object3D, Quaternion, Vector3 } from 'three'
import {
  calculateXROriginOffset,
  calculateXROriginWorld,
  extractCameraWorldYaw,
  extractHeadRotationFromCamera,
  getAvatarEyeWorldPosition,
  worldToLocalOffset,
} from '../xrOrigin'

function createMockBoneNode(position: Vector3 = new Vector3()): Object3D {
  const bone = new Object3D()
  bone.position.copy(position)
  bone.getWorldPosition = vi.fn((target: Vector3) => target.copy(position))
  bone.getWorldQuaternion = vi.fn((target: Quaternion) => target.identity())
  bone.updateWorldMatrix = vi.fn()
  return bone
}

function createMockVRM(
  options: { sceneRotation?: Quaternion; bones?: Record<string, Object3D | null> } = {},
): VRM {
  const { sceneRotation = new Quaternion(), bones = {} } = options

  const scene = new Object3D()
  scene.getWorldQuaternion = vi.fn((target: Quaternion) => target.copy(sceneRotation))
  scene.getWorldPosition = vi.fn((target: Vector3) => target.set(0, 0, 0))

  const humanoid = {
    getNormalizedBoneNode: vi.fn((name: string) => bones[name] ?? null),
    resetNormalizedPose: vi.fn(),
  } as unknown as VRMHumanoid

  return {
    scene,
    humanoid,
    update: vi.fn(),
  } as unknown as VRM
}

describe('xrOriginUtils', () => {
  describe('extractCameraWorldYaw', () => {
    it('yaw=0のQuaternionから0を返す', () => {
      const quat = new Quaternion().setFromEuler(new Euler(0, 0, 0, 'YXZ'))
      const euler = new Euler()
      expect(extractCameraWorldYaw(quat, euler)).toBeCloseTo(0)
    })

    it('yaw=π/2のQuaternionから正しい値を返す', () => {
      const yaw = Math.PI / 2
      const quat = new Quaternion().setFromEuler(new Euler(0, yaw, 0, 'YXZ'))
      const euler = new Euler()
      expect(extractCameraWorldYaw(quat, euler)).toBeCloseTo(yaw)
    })

    it('pitchが含まれていてもyawのみを正しく抽出する', () => {
      const yaw = 0.7
      const pitch = 0.3
      const quat = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'))
      const euler = new Euler()
      expect(extractCameraWorldYaw(quat, euler)).toBeCloseTo(yaw)
    })

    it('負のyawを正しく抽出する', () => {
      const yaw = -1.2
      const quat = new Quaternion().setFromEuler(new Euler(0, yaw, 0, 'YXZ'))
      const euler = new Euler()
      expect(extractCameraWorldYaw(quat, euler)).toBeCloseTo(yaw)
    })
  })

  describe('worldToLocalOffset', () => {
    it('bodyYaw=0ではワールド座標がそのまま返る', () => {
      const offset = { x: 1, y: 2, z: 3 }
      const result = worldToLocalOffset(offset, 0)
      expect(result.x).toBeCloseTo(1)
      expect(result.y).toBeCloseTo(2)
      expect(result.z).toBeCloseTo(3)
    })

    it('bodyYaw=π/2で90度回転変換される', () => {
      const offset = { x: 1, y: 0, z: 0 }
      const result = worldToLocalOffset(offset, Math.PI / 2)
      expect(result.x).toBeCloseTo(0)
      expect(result.y).toBeCloseTo(0)
      expect(result.z).toBeCloseTo(-1)
    })

    it('bodyYaw=πで180度回転変換される', () => {
      const offset = { x: 1, y: 0, z: 0 }
      const result = worldToLocalOffset(offset, Math.PI)
      expect(result.x).toBeCloseTo(-1)
      expect(result.y).toBeCloseTo(0)
      expect(result.z).toBeCloseTo(0)
    })

    it('Y成分はyaw回転の影響を受けない', () => {
      const offset = { x: 0, y: 5, z: 0 }
      const result = worldToLocalOffset(offset, 1.5)
      expect(result.x).toBeCloseTo(0)
      expect(result.y).toBeCloseTo(5)
      expect(result.z).toBeCloseTo(0)
    })

    it('ゼロオフセットはゼロを返す', () => {
      const offset = { x: 0, y: 0, z: 0 }
      const result = worldToLocalOffset(offset, 1.0)
      expect(result.x).toBeCloseTo(0)
      expect(result.y).toBeCloseTo(0)
      expect(result.z).toBeCloseTo(0)
    })
  })

  describe('getAvatarEyeWorldPosition', () => {
    it('leftEyeとrightEyeがある場合、左目の位置を返す', () => {
      const leftEyePos = new Vector3(0.03, 1.6, 0.1)
      const rightEyePos = new Vector3(-0.03, 1.6, 0.1)

      const vrm = createMockVRM({
        bones: {
          leftEye: createMockBoneNode(leftEyePos),
          rightEye: createMockBoneNode(rightEyePos),
        },
      })

      const result = getAvatarEyeWorldPosition(vrm)

      expect(result.x).toBeCloseTo(leftEyePos.x)
      expect(result.y).toBeCloseTo(leftEyePos.y)
      expect(result.z).toBeCloseTo(leftEyePos.z)
    })

    it('目ボーンがなくheadボーンがある場合、頭から推定した位置を返す', () => {
      const headPos = new Vector3(0, 1.5, 0.05)

      const vrm = createMockVRM({
        bones: { head: createMockBoneNode(headPos) },
      })

      const result = getAvatarEyeWorldPosition(vrm)

      expect(result.x).toBeCloseTo(headPos.x)
      expect(result.y).toBeCloseTo(headPos.y + 0.15) // HEAD_TO_EYE_OFFSET
      expect(result.z).toBeCloseTo(headPos.z)
    })

    it('目ボーンも頭ボーンもない場合、原点を返す', () => {
      const vrm = createMockVRM()

      const result = getAvatarEyeWorldPosition(vrm)

      expect(result.x).toBe(0)
      expect(result.y).toBe(0)
      expect(result.z).toBe(0)
    })
  })

  describe('calculateXROriginOffset', () => {
    it('目の位置とカメラ位置の差を返す', () => {
      const eyeWorldPos = new Vector3(1, 1.6, 0.5)
      const cameraPosition = new Vector3(0.5, 1.5, 0.3)

      const result = calculateXROriginOffset(eyeWorldPos, cameraPosition)

      expect(result.x).toBeCloseTo(0.5)
      expect(result.y).toBeCloseTo(0.1)
      expect(result.z).toBeCloseTo(0.2)
    })

    it('同じ位置の場合はゼロを返す', () => {
      const position = new Vector3(1, 1.6, 0.5)

      const result = calculateXROriginOffset(position, position.clone())

      expect(result.x).toBe(0)
      expect(result.y).toBe(0)
      expect(result.z).toBe(0)
    })
  })

  describe('calculateXROriginWorld', () => {
    it('hmdTransformがnullの場合はundefinedを返す', () => {
      const result = calculateXROriginWorld(new Quaternion(), new Vector3(0, 1.6, 0), null)

      expect(result.position).toBeUndefined()
      expect(result.rotation).toBeUndefined()
    })

    it('HMDがローカル原点にある場合、XROriginはカメラ位置と一致する', () => {
      const cameraPos = new Vector3(0, 1.6, 0)
      const hmd = { position: new Vector3(0, 0, 0), rotation: new Quaternion() }

      const result = calculateXROriginWorld(new Quaternion(), cameraPos, hmd)

      expect(result.position!.x).toBeCloseTo(0)
      expect(result.position!.y).toBeCloseTo(1.6)
      expect(result.position!.z).toBeCloseTo(0)
    })

    it('HMDにオフセットがある場合、XROrigin位置が正しく計算される', () => {
      const cameraPos = new Vector3(1, 2, 3)
      const hmd = { position: new Vector3(1, 2, 3), rotation: new Quaternion() }

      const result = calculateXROriginWorld(new Quaternion(), cameraPos, hmd)

      expect(result.position!.x).toBeCloseTo(0)
      expect(result.position!.y).toBeCloseTo(0)
      expect(result.position!.z).toBeCloseTo(0)
    })

    it('scale=1の場合、スケールなしと同じ結果になる', () => {
      const cameraRot = new Quaternion()
      const cameraPos = new Vector3(1, 2, 3)
      const hmd = { position: new Vector3(0, 1.6, 0), rotation: new Quaternion() }

      const withoutScale = calculateXROriginWorld(cameraRot, cameraPos, hmd)
      const withScale = calculateXROriginWorld(cameraRot, cameraPos, hmd, 1)

      expect(withScale.position!.x).toBeCloseTo(withoutScale.position!.x)
      expect(withScale.position!.y).toBeCloseTo(withoutScale.position!.y)
      expect(withScale.position!.z).toBeCloseTo(withoutScale.position!.z)
    })

    it('scale<1の場合、HMDローカル位置にscaleが適用される', () => {
      const cameraPos = new Vector3(0, 0.8, 0)
      const hmd = { position: new Vector3(0, 1.6, 0), rotation: new Quaternion() }

      const result = calculateXROriginWorld(new Quaternion(), cameraPos, hmd, 0.5)

      // position = (0, 0.8, 0) - (0, 1.6*0.5, 0) = (0, 0, 0)
      expect(result.position!.x).toBeCloseTo(0)
      expect(result.position!.y).toBeCloseTo(0)
      expect(result.position!.z).toBeCloseTo(0)
    })

    it('scale>1の場合、HMDローカル位置にscaleが適用される', () => {
      const cameraPos = new Vector3(0, 3.2, 0)
      const hmd = { position: new Vector3(0, 1.6, 0), rotation: new Quaternion() }

      const result = calculateXROriginWorld(new Quaternion(), cameraPos, hmd, 2.0)

      // position = (0, 3.2, 0) - (0, 1.6*2.0, 0) = (0, 0, 0)
      expect(result.position!.x).toBeCloseTo(0)
      expect(result.position!.y).toBeCloseTo(0)
      expect(result.position!.z).toBeCloseTo(0)
    })
  })

  describe('extractHeadRotationFromCamera', () => {
    it('シーンの180°回転に対してπが加算される', () => {
      const sceneRot = new Quaternion().setFromEuler(new Euler(0, Math.PI, 0, 'YXZ'))
      const vrm = createMockVRM({ sceneRotation: sceneRot })
      // カメラがシーンと同じ方向（相対yaw=0）
      const cameraRot = new Quaternion().setFromEuler(new Euler(0, Math.PI, 0, 'YXZ'))

      const { yaw } = extractHeadRotationFromCamera(vrm, cameraRot)

      // 相対yaw=0 → yaw = 0 + π = π（ボーンローカル座標系の正面補正）
      expect(Math.abs(yaw)).toBeCloseTo(Math.PI)
    })

    it('pitchの符号が反転する', () => {
      const sceneRot = new Quaternion().setFromEuler(new Euler(0, Math.PI, 0, 'YXZ'))
      const vrm = createMockVRM({ sceneRotation: sceneRot })
      const pitchAngle = 0.3
      const cameraRot = new Quaternion().setFromEuler(new Euler(pitchAngle, Math.PI, 0, 'YXZ'))

      const { pitch } = extractHeadRotationFromCamera(vrm, cameraRot)

      expect(pitch).toBeCloseTo(-pitchAngle)
    })

    it('rollの符号が反転する', () => {
      const sceneRot = new Quaternion().setFromEuler(new Euler(0, Math.PI, 0, 'YXZ'))
      const vrm = createMockVRM({ sceneRotation: sceneRot })
      const rollAngle = 0.3
      const cameraRot = new Quaternion().setFromEuler(new Euler(0, Math.PI, rollAngle, 'YXZ'))

      const { roll } = extractHeadRotationFromCamera(vrm, cameraRot)

      expect(roll).toBeCloseTo(-rollAngle)
    })

    it('yawが-πからπの範囲に正規化される', () => {
      const sceneRot = new Quaternion().setFromEuler(new Euler(0, Math.PI, 0, 'YXZ'))
      const vrm = createMockVRM({ sceneRotation: sceneRot })
      // シーン正面から+0.5rad右を向く → 相対yaw=0.5 → yaw = 0.5+π > π → 正規化
      const cameraRot = new Quaternion().setFromEuler(new Euler(0, Math.PI + 0.5, 0, 'YXZ'))

      const { yaw } = extractHeadRotationFromCamera(vrm, cameraRot)

      expect(yaw).toBeGreaterThanOrEqual(-Math.PI)
      expect(yaw).toBeLessThanOrEqual(Math.PI)
      expect(yaw).toBeCloseTo(0.5 - Math.PI)
    })

    it('シーン回転がある場合、カメラ回転からシーン回転が除去される', () => {
      const sceneYaw = 0.8
      const sceneRot = new Quaternion().setFromEuler(new Euler(0, sceneYaw, 0, 'YXZ'))
      const vrm = createMockVRM({ sceneRotation: sceneRot })
      // カメラがシーンと逆向き（アバターと同じ向き）→ 相対yaw=π → yaw = π + π ≡ 0
      const cameraRot = new Quaternion().setFromEuler(new Euler(0, sceneYaw + Math.PI, 0, 'YXZ'))

      const { yaw } = extractHeadRotationFromCamera(vrm, cameraRot)

      expect(yaw).toBeCloseTo(0)
    })
  })
})
