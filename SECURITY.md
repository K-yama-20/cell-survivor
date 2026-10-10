# Security Policy

## 報告方法

脆弱性は公開Issueにせず、GitHub Security Advisoriesの **Report a vulnerability** から非公開で報告してください。再現手順、影響、確認したリビジョンを含めてください。

## 現在の安全モデル

正式リリース前は`main`の最新状態のみを対象とします。Electron RendererはNode.js権限を持たず、永続化は限定されたpreload IPCを介します。プレイヤーPythonは専用Workerで動作させ、ObservationとActionの契約だけをゲームへ公開する計画です。

Pyodide Workerを完全なOSセキュリティ境界とは見なしません。ホストファイル、ネットワーク、JavaScript bridge、CPU・メモリ枯渇への到達可能性は、ROADMAP Issue 04と18で実測し、残存リスクを本書へ追記します。安全性が実証できるまで、外部から入手したPythonコードを安全だとは保証しません。
