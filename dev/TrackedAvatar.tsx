import type { VRM } from '@pixiv/three-vrm'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useRef } from 'react'
import { Euler, type Group, Quaternion, Vector3 } from 'three'
import {
  applyArmIKFromTransform,
  applyHandRotationFromTransform,
  applyUpperBodyRotation,
  extractCameraWorldYaw,
  extractHeadRotationFromCamera,
  getAvatarEyeWorldPosition,
} from '../src'
import { useVRControllerPositions } from '../src/react'
import type { SimFrame } from './simulation'

type Props = {
  vrm: VRM
  /** コントローラーの位置を握りの中心として扱う（手首まで戻す） */
  fromGrip: boolean
  /** VR に入らずに動かすとき（見本のポーズ・ログの再生）の手と頭。null なら XR の入力を使う */
  simRef: RefObject<SimFrame | null>
}

const ORIGIN = new Vector3()
const IDENTITY = new Quaternion()
const _sceneWorldQuat = new Quaternion()
const _tempEuler = new Euler()

/**
 * HMD とコントローラーでアバターを動かす（XROrigin は原点に置いたまま）。
 * 体は頭の真下に置いて頭の向きへ回し、目の高さが HMD に合うよう縮尺を合わせる
 */
export function TrackedAvatar({ vrm, fromGrip, simRef }: Props) {
  const groupRef = useRef<Group>(null)
  const eyeHeightRef = useRef<number | null>(null)
  const transformsRef = useVRControllerPositions()

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return
    const camera = state.gl.xr.isPresenting ? state.gl.xr.getCamera() : state.camera

    if (eyeHeightRef.current === null) {
      vrm.scene.updateMatrixWorld(true)
      eyeHeightRef.current = getAvatarEyeWorldPosition(vrm).y / group.scale.y
    }

    // 一人称で頭の中が映らないよう、VR の間は頭（髪ごと）を縮めて隠す
    vrm.humanoid.getRawBoneNode('head')?.scale.setScalar(state.gl.xr.isPresenting ? 0 : 1)

    const sim = state.gl.xr.isPresenting ? null : simRef.current
    if (sim) {
      // ユーザーは -Z を向いて立っている。体を頭の真下に置き、目の高さを頭に合わせる
      group.scale.setScalar(sim.headPosition.y / eyeHeightRef.current)
      group.position.set(sim.headPosition.x, 0, sim.headPosition.z)
      group.rotation.set(0, Math.PI, 0)
      group.updateMatrixWorld(true)
      applyUpperBodyRotation(vrm, 0, 0, 0)

      const left = sim.hands.left?.transform ?? null
      const right = sim.hands.right?.transform ?? null
      vrm.scene.updateWorldMatrix(true, true)
      vrm.scene.getWorldQuaternion(_sceneWorldQuat)
      applyArmIKFromTransform(vrm, left, right, _sceneWorldQuat, {
        xrOriginWorldPos: ORIGIN,
        xrOriginWorldQuat: IDENTITY,
        fromGrip,
      })
      applyHandRotationFromTransform(vrm, left, right, IDENTITY)
    } else if (state.gl.xr.isPresenting) {
      // 目の高さを HMD に合わせ、体を頭の真下で頭の向きへ回す（VRM 1.0 は +Z 向きなので π 足す）
      group.scale.setScalar(camera.position.y / eyeHeightRef.current)
      group.position.set(camera.position.x, 0, camera.position.z)
      const cameraYaw = extractCameraWorldYaw(camera.quaternion, _tempEuler)
      group.rotation.set(0, cameraYaw + Math.PI, 0)
      group.updateMatrixWorld(true)

      const head = extractHeadRotationFromCamera(vrm, camera.quaternion)
      applyUpperBodyRotation(vrm, head.yaw, head.pitch, head.roll)

      const { leftController, rightController } = transformsRef.current
      vrm.scene.updateWorldMatrix(true, true)
      vrm.scene.getWorldQuaternion(_sceneWorldQuat)
      applyArmIKFromTransform(vrm, leftController, rightController, _sceneWorldQuat, {
        xrOriginWorldPos: ORIGIN,
        xrOriginWorldQuat: IDENTITY,
        fromGrip,
      })
      applyHandRotationFromTransform(vrm, leftController, rightController, IDENTITY)
    }

    vrm.update(delta)
  })

  return (
    <group ref={groupRef} rotation={[0, Math.PI, 0]}>
      <primitive object={vrm.scene} />
    </group>
  )
}
