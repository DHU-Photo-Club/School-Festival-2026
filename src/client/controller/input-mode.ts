/** 回答入力の表示状態。未回答、操作中、確定待ち、確定済み、無効（仕様書7.1節）。 */
export type InputMode = "unanswered" | "active" | "pending" | "answered" | "disabled";
