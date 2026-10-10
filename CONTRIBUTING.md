# Contributing

Micro Survivorへの貢献を歓迎します。

1. [ROADMAP.md](docs/ROADMAP.md) と対応するGitHub Issueを読みます。
2. 依存IssueとフェーズのGateが完了していることを確認します。
3. `main`から1 Issue用の短いブランチを作ります。
4. 実装・テスト・関連仕様の更新をまとめます。
5. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`を実行します。
6. Pull Requestテンプレートに検証結果と残存リスクを記載します。

ランタイム、公開Python API、決定論、Electron権限境界の変更はADRと独立レビューを必要とします。脆弱性は公開Issueではなく [SECURITY.md](SECURITY.md) の方法で報告してください。
