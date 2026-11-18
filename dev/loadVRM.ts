import { type VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** URL から VRM を読む。VRM 0.x は扱わないのでエラーにする */
export async function loadVRMFromURL(url: string): Promise<VRM> {
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const gltf = await loader.loadAsync(url)
  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) throw new Error('VRM ではありません')
  if (vrm.meta?.metaVersion === '0') {
    throw new Error('VRM 0.x には対応していません（1.0 に変換してください）')
  }
  VRMUtils.removeUnnecessaryVertices(gltf.scene)
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false
  })
  return vrm
}

/** 選んだファイルから VRM を読む */
export async function loadVRMFromFile(file: File): Promise<VRM> {
  const url = URL.createObjectURL(file)
  try {
    return await loadVRMFromURL(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}
