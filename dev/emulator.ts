import { DevUI } from '@iwer/devui'
import { metaQuest3, XRDevice } from 'iwer'

/**
 * VR 機材が無いときだけ IWER のエミュレーター（Quest 3）を入れる。
 * デスクトップの Chrome は機材が無くても navigator.xr を持っているので、
 * 置き換えるには forceInstall が要る。実機のブラウザではそのまま本物を使う
 */
export async function setupEmulatorIfNeeded(): Promise<void> {
  const supported = await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false)
  if (supported) return
  const device = new XRDevice(metaQuest3)
  device.installRuntime({ forceInstall: true })
  device.installDevUI(DevUI)
}
