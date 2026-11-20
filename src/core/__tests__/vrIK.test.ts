import type { VRM, VRMHumanoid } from '@pixiv/three-vrm'
import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import {
  applyKneeBend,
  applyUpperBodyRotation,
  CONTROLLER_ROTATION_OFFSET_LEFT,
  CONTROLLER_ROTATION_OFFSET_RIGHT,
  computeGravityBasedPoleVector,
  DEFAULT_LEG_LENGTH,
  DEFAULT_PALM_LENGTH,
  GRIP_PALM_RATIO,
  getControllerRotationOffset,
  getGripLocalOffset,
  gripToWristPosition,
  HAND_TRACKING_ROTATION_OFFSET_LEFT,
  HAND_TRACKING_ROTATION_OFFSET_RIGHT,
  LEG_BONE_PATTERNS,
  ROTATION_DISTRIBUTION,
} from '../vrIK'

describe('vrIK', () => {
  describe('定数', () => {
    describe('ROTATION_DISTRIBUTION', () => {
      it('spine, chest, headの合計が1.0になる', () => {
        const total =
          ROTATION_DISTRIBUTION.spine + ROTATION_DISTRIBUTION.chest + ROTATION_DISTRIBUTION.head
        expect(total).toBeCloseTo(1.0)
      })

      it('各部位に正の値が設定されている', () => {
        expect(ROTATION_DISTRIBUTION.spine).toBeGreaterThan(0)
        expect(ROTATION_DISTRIBUTION.chest).toBeGreaterThan(0)
        expect(ROTATION_DISTRIBUTION.head).toBeGreaterThan(0)
      })

      it('headが最も大きい比率を持つ', () => {
        expect(ROTATION_DISTRIBUTION.head).toBeGreaterThan(ROTATION_DISTRIBUTION.chest)
        expect(ROTATION_DISTRIBUTION.chest).toBeGreaterThan(ROTATION_DISTRIBUTION.spine)
      })
    })

    describe('DEFAULT_LEG_LENGTH', () => {
      it('妥当な足の長さが設定されている（0.5m〜1.2m）', () => {
        expect(DEFAULT_LEG_LENGTH).toBeGreaterThanOrEqual(0.5)
        expect(DEFAULT_LEG_LENGTH).toBeLessThanOrEqual(1.2)
      })
    })

    describe('LEG_BONE_PATTERNS', () => {
      it('足のボーンパターンが含まれている', () => {
        // 部分一致でフィルタリングするため、左右を区別しない汎用パターン
        expect(LEG_BONE_PATTERNS).toContain('UpperLeg')
        expect(LEG_BONE_PATTERNS).toContain('LowerLeg')
        expect(LEG_BONE_PATTERNS).toContain('Foot')
        expect(LEG_BONE_PATTERNS).toContain('ToeBase')
      })

      it('4つのボーンパターンが定義されている', () => {
        expect(LEG_BONE_PATTERNS).toHaveLength(4)
      })

      it('VRM 1.0 の正規化ボーンのトラック名にマッチする', () => {
        const tracks = [
          'Normalized_J_Bip_L_UpperLeg.quaternion',
          'Normalized_J_Bip_L_LowerLeg.quaternion',
          'Normalized_J_Bip_L_Foot.quaternion',
          'Normalized_J_Bip_L_ToeBase.quaternion',
          'Normalized_J_Bip_R_UpperLeg.quaternion',
          'Normalized_J_Bip_R_LowerLeg.quaternion',
          'Normalized_J_Bip_R_Foot.quaternion',
          'Normalized_J_Bip_R_ToeBase.quaternion',
        ]

        tracks.forEach((track) => {
          const matches = LEG_BONE_PATTERNS.some((pattern) => track.includes(pattern))
          expect(matches).toBe(true)
        })
      })

      it('腕のボーンにはマッチしない', () => {
        const armTracks = [
          'Normalized_J_Bip_L_UpperArm.quaternion',
          'Normalized_J_Bip_R_LowerArm.quaternion',
        ]

        armTracks.forEach((track) => {
          const matches = LEG_BONE_PATTERNS.some((pattern) => track.includes(pattern))
          expect(matches).toBe(false)
        })
      })
    })
  })

  describe('computeGravityBasedPoleVector', () => {
    const identityQuat = new Quaternion()

    describe('基本的な動作', () => {
      it('正規化されたベクトルを返す', () => {
        const shoulderPos = new Vector3(0, 1.5, 0)
        const targetPos = new Vector3(0.5, 1.0, 0)
        const result = computeGravityBasedPoleVector(shoulderPos, targetPos, true, identityQuat)

        expect(result.length()).toBeCloseTo(1.0)
      })

      it('ターゲット方向に垂直なベクトルを返す', () => {
        const shoulderPos = new Vector3(0, 1.5, 0)
        const targetPos = new Vector3(0.5, 1.0, 0)
        const result = computeGravityBasedPoleVector(shoulderPos, targetPos, true, identityQuat)

        const targetDir = targetPos.clone().sub(shoulderPos).normalize()
        const dotProduct = result.dot(targetDir)

        // ターゲット方向に垂直（内積が0に近い）
        expect(Math.abs(dotProduct)).toBeLessThan(0.01)
      })
    })

    describe('左腕と右腕の違い', () => {
      // VRM 1.0 はアバターが +Z を向くので、左腕は +X 側・右腕は -X 側
      it('左腕の場合、肘が外側（+X方向）を向く傾向がある', () => {
        const shoulderPos = new Vector3(0.2, 1.5, 0)
        const targetPos = new Vector3(0.5, 1.0, 0.3)
        const result = computeGravityBasedPoleVector(shoulderPos, targetPos, true, identityQuat)

        expect(result.x).toBeGreaterThan(0)
      })

      it('右腕の場合、肘が外側（-X方向）を向く傾向がある', () => {
        const shoulderPos = new Vector3(-0.2, 1.5, 0)
        const targetPos = new Vector3(-0.5, 1.0, 0.3)
        const result = computeGravityBasedPoleVector(shoulderPos, targetPos, false, identityQuat)

        expect(result.x).toBeLessThan(0)
      })

      it('左腕と右腕でX方向の符号が逆になる', () => {
        const leftShoulderPos = new Vector3(-0.2, 1.5, 0)
        const leftTargetPos = new Vector3(-0.5, 1.2, -0.3)
        const leftResult = computeGravityBasedPoleVector(
          leftShoulderPos,
          leftTargetPos,
          true,
          identityQuat,
        )

        const rightShoulderPos = new Vector3(0.2, 1.5, 0)
        const rightTargetPos = new Vector3(0.5, 1.2, -0.3)
        const rightResult = computeGravityBasedPoleVector(
          rightShoulderPos,
          rightTargetPos,
          false,
          identityQuat,
        )

        // 左腕と右腕でX成分の符号が逆
        expect(Math.sign(leftResult.x)).not.toBe(Math.sign(rightResult.x))
      })
    })

    describe('シーン回転の影響', () => {
      it('シーンが90度Y軸回転した場合、ポールベクトルも回転する', () => {
        const shoulderPos = new Vector3(0, 1.5, 0)
        const targetPos = new Vector3(0.5, 1.0, 0)

        // 回転なし
        const resultNoRotation = computeGravityBasedPoleVector(
          shoulderPos,
          targetPos,
          false,
          identityQuat,
        )

        // 90度Y軸回転
        const rotatedQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
        const resultRotated = computeGravityBasedPoleVector(
          shoulderPos,
          targetPos,
          false,
          rotatedQuat,
        )

        // 回転後は異なるベクトルになる
        const distance = resultNoRotation.distanceTo(resultRotated)
        expect(distance).toBeGreaterThan(0.1)
      })

      // 手のひらを下・指先を前（-Z）にした手。wrist はワールドと同じ向き（WebXR の仕様）
      // grip は -Z が親指の方、+X が手の甲（右手。左手は -X）
      const gripOf = (x: Vector3, y: Vector3, z: Vector3) =>
        new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))

      it('右手: wrist にオフセットを掛けると grip の向きになる', () => {
        const grip = gripOf(new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0))
        expect(HAND_TRACKING_ROTATION_OFFSET_RIGHT.angleTo(grip)).toBeCloseTo(0)
      })

      it('左手: wrist にオフセットを掛けると grip の向きになる', () => {
        const grip = gripOf(new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(-1, 0, 0))
        expect(HAND_TRACKING_ROTATION_OFFSET_LEFT.angleTo(grip)).toBeCloseTo(0)
      })
    })

    describe('エッジケース', () => {
      it('肩とターゲットが同じ位置でもクラッシュしない', () => {
        const shoulderPos = new Vector3(0, 1.5, 0)
        const targetPos = new Vector3(0, 1.5, 0)

        expect(() => {
          computeGravityBasedPoleVector(shoulderPos, targetPos, true, identityQuat)
        }).not.toThrow()
      })

      it('ターゲットが真下の場合でも正規化されたベクトルを返す', () => {
        const shoulderPos = new Vector3(0, 1.5, 0)
        const targetPos = new Vector3(0, 0.5, 0)
        const result = computeGravityBasedPoleVector(shoulderPos, targetPos, true, identityQuat)

        expect(result.length()).toBeCloseTo(1.0)
      })

      it('ターゲットが真上の場合でも正規化されたベクトルを返す', () => {
        const shoulderPos = new Vector3(0, 1.5, 0)
        const targetPos = new Vector3(0, 2.5, 0)
        const result = computeGravityBasedPoleVector(shoulderPos, targetPos, true, identityQuat)

        expect(result.length()).toBeCloseTo(1.0)
      })
    })

    describe('腕を前に伸ばした場合', () => {
      it('肘が下を向く（重力方向）', () => {
        const shoulderPos = new Vector3(0, 1.5, 0)
        const targetPos = new Vector3(0, 1.5, -0.6) // 前方向
        const result = computeGravityBasedPoleVector(shoulderPos, targetPos, true, identityQuat)

        // Y成分が負（下向き）であることを確認
        expect(result.y).toBeLessThan(0)
      })
    })
  })

  describe('getGripLocalOffset', () => {
    it('中指の付け根があれば、その位置の GRIP_PALM_RATIO 倍', () => {
      const hand = new Object3D()
      hand.position.set(0.25, 0, 0)
      const middleProximal = new Object3D()
      middleProximal.position.set(0.1, -0.01, 0.02)
      const result = getGripLocalOffset(hand, middleProximal, new Vector3())
      expect(result.x).toBeCloseTo(0.1 * GRIP_PALM_RATIO)
      expect(result.y).toBeCloseTo(-0.01 * GRIP_PALM_RATIO)
      expect(result.z).toBeCloseTo(0.02 * GRIP_PALM_RATIO)
    })

    it('中指の付け根が無ければ、手の伸びる向きに既定の長さ', () => {
      const hand = new Object3D()
      hand.position.set(-0.25, 0, 0)
      const result = getGripLocalOffset(hand, null, new Vector3())
      expect(result.x).toBeCloseTo(-DEFAULT_PALM_LENGTH * GRIP_PALM_RATIO)
      expect(result.y).toBeCloseTo(0)
      expect(result.z).toBeCloseTo(0)
    })
  })

  describe('gripToWristPosition', () => {
    it('回転なしなら、握りの中心からオフセットぶん戻る', () => {
      const result = gripToWristPosition(
        new Vector3(1, 1, 1),
        new Quaternion(),
        new Vector3(0.06, 0, 0),
        1,
        new Vector3(),
      )
      expect(result.x).toBeCloseTo(0.94)
      expect(result.y).toBeCloseTo(1)
      expect(result.z).toBeCloseTo(1)
    })

    it('手の回転とスケールに沿って戻る', () => {
      // ローカル +X（手先）を -Z（前）へ向ける回転
      const quat = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0))
      const result = gripToWristPosition(
        new Vector3(0, 1, -0.5),
        quat,
        new Vector3(0.06, 0, 0),
        2,
        new Vector3(),
      )
      // 手先が前なので、手首は握りの中心より 0.12 後ろ（+Z）
      expect(result.x).toBeCloseTo(0)
      expect(result.y).toBeCloseTo(1)
      expect(result.z).toBeCloseTo(-0.38)
    })

    it('out に握りの中心と同じ Vector3 を渡しても正しく求まる', () => {
      const grip = new Vector3(0, 0, 0)
      gripToWristPosition(grip, new Quaternion(), new Vector3(0, 0.05, 0), 1, grip)
      expect(grip.y).toBeCloseTo(-0.05)
    })
  })

  describe('getControllerRotationOffset', () => {
    it('左右のオフセットを返す', () => {
      expect(getControllerRotationOffset(true)).toBe(CONTROLLER_ROTATION_OFFSET_LEFT)
      expect(getControllerRotationOffset(false)).toBe(CONTROLLER_ROTATION_OFFSET_RIGHT)
    })

    describe('オフセット値の妥当性', () => {
      it('コントローラー用オフセットは正規化されたクォータニオン', () => {
        expect(CONTROLLER_ROTATION_OFFSET_LEFT.length()).toBeCloseTo(1.0)
        expect(CONTROLLER_ROTATION_OFFSET_RIGHT.length()).toBeCloseTo(1.0)
      })

      it('ハンドトラッキング用オフセットは正規化されたクォータニオン', () => {
        expect(HAND_TRACKING_ROTATION_OFFSET_LEFT.length()).toBeCloseTo(1.0)
        expect(HAND_TRACKING_ROTATION_OFFSET_RIGHT.length()).toBeCloseTo(1.0)
      })

      it('ハンドトラッキング用オフセットは左右で鏡像関係（Z軸回転が逆）', () => {
        // 左右のオフセットが異なることを確認
        const distance = HAND_TRACKING_ROTATION_OFFSET_LEFT.angleTo(
          HAND_TRACKING_ROTATION_OFFSET_RIGHT,
        )
        expect(distance).toBeGreaterThan(0.1)
      })

      // 手のひらを下・指先を前（-Z）にした手。wrist はワールドと同じ向き（WebXR の仕様）
      // grip は -Z が親指の方、+X が手の甲（右手。左手は -X）
      const gripOf = (x: Vector3, y: Vector3, z: Vector3) =>
        new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))

      it('右手: wrist にオフセットを掛けると grip の向きになる', () => {
        const grip = gripOf(new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0))
        expect(HAND_TRACKING_ROTATION_OFFSET_RIGHT.angleTo(grip)).toBeCloseTo(0)
      })

      it('左手: wrist にオフセットを掛けると grip の向きになる', () => {
        const grip = gripOf(new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(-1, 0, 0))
        expect(HAND_TRACKING_ROTATION_OFFSET_LEFT.angleTo(grip)).toBeCloseTo(0)
      })
    })
  })

  describe('applyKneeBend', () => {
    // 足ボーンのモックを作成するヘルパー関数
    function createMockLegBones() {
      const leftUpperLeg = new Object3D()
      const leftLowerLeg = new Object3D()
      const rightUpperLeg = new Object3D()
      const rightLowerLeg = new Object3D()
      return { leftUpperLeg, leftLowerLeg, rightUpperLeg, rightLowerLeg }
    }

    // ボーン付きVRMモックを作成するヘルパー関数
    function createMockVRMWithBones() {
      const bones = createMockLegBones()
      const humanoid = {
        getNormalizedBoneNode: (boneName: string) => {
          switch (boneName) {
            case 'leftUpperLeg':
              return bones.leftUpperLeg
            case 'leftLowerLeg':
              return bones.leftLowerLeg
            case 'rightUpperLeg':
              return bones.rightUpperLeg
            case 'rightLowerLeg':
              return bones.rightLowerLeg
            default:
              return null
          }
        },
      } as unknown as VRMHumanoid

      const vrm = { humanoid } as VRM

      return { vrm, bones }
    }

    it('しゃがみ時、太ももは前へ上がり膝は後ろへ曲がる', () => {
      const { vrm, bones } = createMockVRMWithBones()

      applyKneeBend(vrm, 0.2, DEFAULT_LEG_LENGTH)

      // アバターが +Z を向くので、太ももを前へ上げるのは X 軸回りの負、膝はその逆
      expect(bones.leftUpperLeg.rotation.x).toBeLessThan(0)
      expect(bones.rightUpperLeg.rotation.x).toBeLessThan(0)
      expect(bones.leftLowerLeg.rotation.x).toBeGreaterThan(0)
      expect(bones.rightLowerLeg.rotation.x).toBeGreaterThan(0)
    })

    it('下がった量が脚の長さを超えても曲げは最大で止まる', () => {
      const { vrm: deep, bones: deepBones } = createMockVRMWithBones()
      const { vrm: full, bones: fullBones } = createMockVRMWithBones()

      applyKneeBend(deep, DEFAULT_LEG_LENGTH * 2, DEFAULT_LEG_LENGTH)
      applyKneeBend(full, DEFAULT_LEG_LENGTH, DEFAULT_LEG_LENGTH)

      expect(deepBones.leftLowerLeg.rotation.x).toBeCloseTo(fullBones.leftLowerLeg.rotation.x)
    })
  })

  describe('applyUpperBodyRotation', () => {
    // 上半身ボーン付きVRMモックを作成するヘルパー関数
    function createMockVRMWithUpperBodyBones() {
      const spine = new Object3D()
      const chest = new Object3D()
      const head = new Object3D()
      const humanoid = {
        getNormalizedBoneNode: (boneName: string) => {
          switch (boneName) {
            case 'spine':
              return spine
            case 'chest':
              return chest
            case 'head':
              return head
            default:
              return null
          }
        },
      } as unknown as VRMHumanoid

      const vrm = { humanoid } as VRM

      return { vrm, spine, chest, head }
    }

    function getBoneEuler(bone: Object3D): Euler {
      return new Euler().setFromQuaternion(bone.quaternion, 'YXZ')
    }

    it('yawがspine/chest/headにROTATION_DISTRIBUTIONで分散される', () => {
      const { vrm, spine, chest, head } = createMockVRMWithUpperBodyBones()
      const yaw = 1.0

      applyUpperBodyRotation(vrm, yaw, 0)

      expect(getBoneEuler(spine).y).toBeCloseTo(yaw * ROTATION_DISTRIBUTION.spine)
      expect(getBoneEuler(chest).y).toBeCloseTo(yaw * ROTATION_DISTRIBUTION.chest)
      expect(getBoneEuler(head).y).toBeCloseTo(yaw * ROTATION_DISTRIBUTION.head)
    })

    it('pitchはheadのみに適用される', () => {
      const { vrm, spine, chest, head } = createMockVRMWithUpperBodyBones()
      const pitch = 0.4

      applyUpperBodyRotation(vrm, 0, pitch)

      expect(getBoneEuler(spine).x).toBeCloseTo(0)
      expect(getBoneEuler(chest).x).toBeCloseTo(0)
      expect(getBoneEuler(head).x).toBeCloseTo(pitch)
    })

    it('roll（首かしげ）はheadのみに適用される', () => {
      const { vrm, spine, chest, head } = createMockVRMWithUpperBodyBones()
      const roll = 0.3

      applyUpperBodyRotation(vrm, 0, 0, roll)

      expect(getBoneEuler(spine).z).toBeCloseTo(0)
      expect(getBoneEuler(chest).z).toBeCloseTo(0)
      expect(getBoneEuler(head).z).toBeCloseTo(roll)
    })

    it('roll省略時はheadのZ回転が0になる', () => {
      const { vrm, head } = createMockVRMWithUpperBodyBones()

      applyUpperBodyRotation(vrm, 0.5, 0.2)

      expect(getBoneEuler(head).z).toBeCloseTo(0)
    })
  })
})
