---
"@webxr-jp/vrm-xr-tracking": minor
---

ハンドトラッキングで、親指が手のひらの前へ回り込む動きも指の曲がりに入れる。`computeFingerCurls`・`readHandFingerCurls` に手の左右（handedness）を渡すと、親指は「関節の曲がり」と「手のひらの前への回り込み」の大きいほうを使う（握りこぶしで親指が 0.3〜0.6 にとどまっていたのが 1 まで届く）。`measureThumbSwing` も足した。
