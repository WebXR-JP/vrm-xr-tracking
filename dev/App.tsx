import type { VRM } from '@pixiv/three-vrm'
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { createXRStore, XR } from '@react-three/xr'
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AVATAR_COLOR, HandGizmos, type HandMetrics, INPUT_COLOR } from './HandGizmos'
import { loadVRMFromFile, loadVRMFromURL } from './loadVRM'
import { POSE_PRESETS, SIDES } from './poses'
import { parseAttributes, type ReplayData, readReplay } from './replay'
import { buildSimFrame, type SimFrame } from './simulation'
import { TrackedAvatar } from './TrackedAvatar'

// 機材が無いときは main.tsx で IWER のエミュレーターを入れている（DevUI でコントローラーを動かせる）
const store = createXRStore({ emulate: false })

/** 動かし方: XR の入力（エミュレーター・実機）か、見本のポーズか */
type Mode = 'xr' | 'pose'

const panelStyle = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 320,
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
  padding: 12,
  background: 'rgba(0, 0, 0, 0.7)',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.5,
} as const

const sectionStyle = { display: 'flex', flexDirection: 'column', gap: 6 } as const
const mutedStyle = { color: '#aaa', fontSize: 12 } as const
const SIDE_LABEL = { left: '左手', right: '右手' } as const
const NO_METRICS: HandMetrics = { left: null, right: null }

/** ずれの角度の色（10° 以内なら合っている） */
function metricColor(degrees: number): string {
  if (degrees <= 10) return '#8be28b'
  if (degrees <= 30) return '#ffd27a'
  return '#ff8a8a'
}

export function App() {
  const [vrm, setVRM] = useState<VRM | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fromGrip, setFromGrip] = useState(true)
  const [mode, setMode] = useState<Mode>('pose')
  const [presetId, setPresetId] = useState(POSE_PRESETS[0].id)
  const [logText, setLogText] = useState('')
  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [replayError, setReplayError] = useState<string | null>(null)
  const [useRecordedPose, setUseRecordedPose] = useState(true)
  const [metrics, setMetrics] = useState<HandMetrics>(NO_METRICS)
  const simRef = useRef<SimFrame | null>(null)

  // ?vrm=<URL> で最初から読む（dev/public に置いたファイルは /<名前> で読める）
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('vrm')
    if (!url) return
    loadVRMFromURL(url)
      .then(setVRM)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const preset = POSE_PRESETS.find((p) => p.id === presetId) ?? POSE_PRESETS[0]
  const hasRecordedPose = !!replay && SIDES.some((side) => replay.hands[side].pose)
  const simFrame = useMemo(
    () => (mode === 'pose' ? buildSimFrame(preset, replay, useRecordedPose) : null),
    [mode, preset, replay, useRecordedPose],
  )
  simRef.current = simFrame

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

  const handleMode = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setMode(e.target.value as Mode)
    setMetrics(NO_METRICS)
  }, [])

  const handlePreset = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setPresetId(e.target.value)
  }, [])

  const handleLogText = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setLogText(e.target.value)
  }, [])

  const handleLoadLog = useCallback(() => {
    const data = readReplay(parseAttributes(logText))
    setReplay(data)
    setReplayError(data ? null : '手のデータ（left.joints・left.pose など）が見つかりません')
  }, [logText])

  const handleClearLog = useCallback(() => {
    setLogText('')
    setReplay(null)
    setReplayError(null)
  }, [])

  const handleUseRecordedPose = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setUseRecordedPose(e.target.checked)
  }, [])

  const handleEnterVR = useCallback(() => {
    store.enterVR()
  }, [])

  const isUsingRecordedPose = mode === 'pose' && useRecordedPose && hasRecordedPose

  return (
    <>
      <div style={panelStyle}>
        <label>
          VRM 1.0 を選ぶ <input type="file" accept=".vrm" onChange={handleFile} />
        </label>
        {error && <div style={{ color: '#ff8a8a' }}>{error}</div>}

        <div style={sectionStyle}>
          <strong>動かし方</strong>
          <label>
            <input
              type="radio"
              name="mode"
              value="pose"
              checked={mode === 'pose'}
              onChange={handleMode}
            />{' '}
            見本のポーズ（VR に入らずに見る）
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="xr"
              checked={mode === 'xr'}
              onChange={handleMode}
            />{' '}
            XR の入力（エミュレーター・実機）
          </label>
        </div>

        {mode === 'pose' && (
          <label style={sectionStyle}>
            ポーズ
            <select value={presetId} onChange={handlePreset} disabled={isUsingRecordedPose}>
              {POSE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === 'xr' && (
          <div style={sectionStyle}>
            <label>
              <input type="checkbox" checked={fromGrip} onChange={handleFromGrip} />{' '}
              握りの中心から手首へ戻す（fromGrip）
            </label>
            <button type="button" onClick={handleEnterVR} disabled={!vrm}>
              VR に入る
            </button>
          </div>
        )}

        {mode === 'pose' && (
          <div style={sectionStyle}>
            <strong>実機のログで試す</strong>
            <span style={mutedStyle}>
              XRift の Sentry のログ（xr input snapshot・tracking calibration）の属性を JSON
              か「キー: 値」の行で貼る。手の関節があれば、その端末の手の形で見本のポーズを取る
            </span>
            <textarea
              value={logText}
              onChange={handleLogText}
              rows={4}
              placeholder={'{ "left.joints": "wrist:0,0,0,…", … }'}
              style={{ fontFamily: 'monospace', fontSize: 11 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={handleLoadLog} disabled={!logText.trim()}>
                読み込む
              </button>
              <button type="button" onClick={handleClearLog} disabled={!replay && !logText}>
                消す
              </button>
            </div>
            {replayError && <div style={{ color: '#ff8a8a' }}>{replayError}</div>}
            {replay && (
              <div style={sectionStyle}>
                <span style={mutedStyle}>
                  {replay.device || '端末不明'}
                  {replay.step ? `（${replay.step}）` : ''}
                </span>
                {hasRecordedPose && (
                  <label>
                    <input
                      type="checkbox"
                      checked={useRecordedPose}
                      onChange={handleUseRecordedPose}
                    />{' '}
                    ログの姿勢をそのまま使う
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        <div style={sectionStyle}>
          <strong>手の向きのずれ</strong>
          <span style={mutedStyle}>
            <span style={{ color: INPUT_COLOR }}>水色</span>が本当の手、
            <span style={{ color: AVATAR_COLOR }}>橙</span>
            がアバターの手。長い矢印が指先、短い矢印が手のひら
          </span>
          {SIDES.map((side) => {
            const m = metrics[side]
            const deviation = simFrame?.hands[side]?.specDeviation
            return (
              <div key={side}>
                {SIDE_LABEL[side]}:{' '}
                {m ? (
                  <>
                    指先 <span style={{ color: metricColor(m.finger) }}>{m.finger}°</span>・手のひら{' '}
                    <span style={{ color: metricColor(m.palm) }}>{m.palm}°</span>
                  </>
                ) : (
                  <span style={mutedStyle}>—</span>
                )}
                {deviation && (
                  <div style={mutedStyle}>
                    端末の wrist の仕様からのずれ: 指先 {deviation.finger}°・手のひら{' '}
                    {deviation.palm}°
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <Canvas camera={{ position: [1.2, 1.6, -2.2] }}>
        <XR store={store}>
          <color attach="background" args={['#1e1f24']} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[1, 3, 2]} intensity={1.5} />
          <gridHelper args={[10, 10]} />
          {vrm && <TrackedAvatar vrm={vrm} fromGrip={fromGrip} simRef={simRef} />}
          {vrm && <HandGizmos vrm={vrm} simRef={simRef} onMetrics={setMetrics} />}
          <OrbitControls target={[0, 1.2, 0]} />
        </XR>
      </Canvas>
    </>
  )
}
