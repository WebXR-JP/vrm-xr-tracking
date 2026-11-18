import { Quaternion, Vector3 } from 'three'
import {
  createControllerTransform,
  getControllerSpace,
  updateTransformFromPose,
} from '../controllerPose'

describe('VRControllerPositions utils', () => {
  describe('createControllerTransform', () => {
    it('Vector3とQuaternionを持つオブジェクトを返す', () => {
      const transform = createControllerTransform()

      expect(transform.position).toBeInstanceOf(Vector3)
      expect(transform.rotation).toBeInstanceOf(Quaternion)
      expect(transform.position.x).toBe(0)
      expect(transform.position.y).toBe(0)
      expect(transform.position.z).toBe(0)
      expect(transform.rotation.x).toBe(0)
      expect(transform.rotation.y).toBe(0)
      expect(transform.rotation.z).toBe(0)
      expect(transform.rotation.w).toBe(1)
    })

    it('デフォルトでisHandTrackingはfalse', () => {
      const transform = createControllerTransform()
      expect(transform.isHandTracking).toBe(false)
    })

    it('isHandTracking=trueを渡すとtrueが設定される', () => {
      const transform = createControllerTransform(true)
      expect(transform.isHandTracking).toBe(true)
    })
  })

  describe('updateTransformFromPose', () => {
    it('XRPoseから位置と回転を正しく更新する', () => {
      const transform = createControllerTransform()
      const mockPose = {
        transform: {
          position: { x: 1.5, y: 2.0, z: -3.5, w: 1 },
          orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
          matrix: new Float32Array(16),
          inverse: {
            matrix: new Float32Array(16),
            position: { x: 0, y: 0, z: 0, w: 1 },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
        linearVelocity: undefined,
        angularVelocity: undefined,
        emulatedPosition: false,
      } as unknown as XRPose

      updateTransformFromPose(transform, mockPose)

      expect(transform.position.x).toBeCloseTo(1.5)
      expect(transform.position.y).toBeCloseTo(2.0)
      expect(transform.position.z).toBeCloseTo(-3.5)
      expect(transform.rotation.x).toBeCloseTo(0.1)
      expect(transform.rotation.y).toBeCloseTo(0.2)
      expect(transform.rotation.z).toBeCloseTo(0.3)
      expect(transform.rotation.w).toBeCloseTo(0.9)
    })
  })

  describe('getControllerSpace', () => {
    it('gripSpaceが存在する場合はgripSpaceを返す（コントローラー）', () => {
      const mockGripSpace = {} as XRSpace
      const inputSource = {
        gripSpace: mockGripSpace,
        hand: null,
      } as unknown as XRInputSource

      const result = getControllerSpace(inputSource)

      expect(result).toBe(mockGripSpace)
    })

    it('handが存在する場合はwristジョイントのspaceを返す（ハンドトラッキング）', () => {
      const mockWristSpace = {} as XRJointSpace
      const mockHand = {
        get: (jointName: string) => (jointName === 'wrist' ? mockWristSpace : null),
      } as unknown as XRHand
      const inputSource = {
        gripSpace: null,
        hand: mockHand,
      } as unknown as XRInputSource

      const result = getControllerSpace(inputSource)

      expect(result).toBe(mockWristSpace)
    })

    it('gripSpaceもhandも無い場合はnullを返す', () => {
      const inputSource = {
        gripSpace: null,
        hand: null,
      } as unknown as XRInputSource

      const result = getControllerSpace(inputSource)

      expect(result).toBeNull()
    })

    it('handはあるがwristジョイントが取得できない場合はnullを返す', () => {
      const mockHand = {
        get: () => null,
      } as unknown as XRHand
      const inputSource = {
        gripSpace: null,
        hand: mockHand,
      } as unknown as XRInputSource

      const result = getControllerSpace(inputSource)

      expect(result).toBeNull()
    })
  })
})
