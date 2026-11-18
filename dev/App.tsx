import type { VRM } from '@pixiv/three-vrm'
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { createXRStore, XR } from '@react-three/xr'
import { type ChangeEvent, useCallback, useEffect, useState } from 'react'
import { loadVRMFromFile, loadVRMFromURL } from './loadVRM'
import { TrackedAvatar } from './TrackedAvatar'

// 機材が無いときは main.tsx で IWER のエミュレーターを入れている（DevUI でコントローラーを動かせる）
const store = createXRStore({ emulate: false })

const panelStyle = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  background: 'rgba(0, 0, 0, 0.6)',
  borderRadius: 8,
  fontSize: 14,
} as const

export function App() {
  const [vrm, setVRM] = useState<VRM | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fromGrip, setFromGrip] = useState(true)

  // ?vrm=<URL> で最初から読む（dev/public に置いたファイルは /<名前> で読める）
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('vrm')
    if (!url) return
    loadVRMFromURL(url)
      .then(setVRM)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const handleFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      setVRM(await loadVRMFromFile(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleFromGrip = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setFromGrip(e.target.checked)
  }, [])

  const handleEnterVR = useCallback(() => {
    store.enterVR()
  }, [])

  return (
    <>
      <div style={panelStyle}>
        <label>
          VRM 1.0 を選ぶ <input type="file" accept=".vrm" onChange={handleFile} />
        </label>
        <label>
          <input type="checkbox" checked={fromGrip} onChange={handleFromGrip} />{' '}
          握りの中心から手首へ戻す（fromGrip）
        </label>
        <button type="button" onClick={handleEnterVR} disabled={!vrm}>
          VR に入る
        </button>
        {error && <div style={{ color: '#ff8a8a' }}>{error}</div>}
      </div>
      <Canvas camera={{ position: [0, 1.4, 2.2] }}>
        <XR store={store}>
          <color attach="background" args={['#1e1f24']} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[1, 3, 2]} intensity={1.5} />
          <gridHelper args={[10, 10]} />
          {vrm && <TrackedAvatar vrm={vrm} fromGrip={fromGrip} />}
          <OrbitControls target={[0, 1, 0]} />
        </XR>
      </Canvas>
    </>
  )
}
