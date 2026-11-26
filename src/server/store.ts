import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Store } from "./core.ts";

/** 展示状態、結果の記録、結果ページへの送信待ちを保存するSQLiteのキー・値ストア。値はJSONで保存する。 */
export interface SqliteStore extends Store {
	delete(key: string): void;
	/** `prefix` で始まるキーの値を、キーの順に返す。 */
	list<T>(prefix: string): T[];
	close(): void;
}

/**
 * `path` のSQLiteファイルを開く。`:memory:` ならメモリ上に作り、プロセスの終了で破棄する（E2Eテスト用）。
 * 読み書きは同期処理のため、展示状態の更新の途中に他のメッセージの処理が割り込むことはない。
 */
export function openStore(path: string): SqliteStore {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT");
	const select = db.prepare("SELECT value FROM kv WHERE key = ?");
	const upsert = db.prepare(
		"INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
	);
	const remove = db.prepare("DELETE FROM kv WHERE key = ?");
	// `prefix` の直後の文字コードを上限にして、前方一致を範囲検索にする（LIKEのエスケープを避ける）。
	const range = db.prepare("SELECT value FROM kv WHERE key >= ? AND key < ? ORDER BY key");

	return {
		get<T>(key: string): T | undefined {
			const row = select.get(key) as { value: string } | undefined;
			return row ? (JSON.parse(row.value) as T) : undefined;
		},
		put(key, value) {
			upsert.run(key, JSON.stringify(value));
		},
		delete(key) {
			remove.run(key);
		},
		list<T>(prefix: string): T[] {
			const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
			return (range.all(prefix, end) as { value: string }[]).map((row) => JSON.parse(row.value) as T);
		},
		close() {
			db.close();
		},
	};
}
