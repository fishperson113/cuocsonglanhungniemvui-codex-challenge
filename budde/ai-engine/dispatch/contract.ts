/**
 * Re-export contract dùng chung của cả app (`budde/shared/contract.ts`) — SINGLE
 * SOURCE OF TRUTH mà service `board` + FE cùng dùng. Để 1 nơi tránh drift.
 *
 * Module dispatch import "./contract.ts" như cũ; thực chất trỏ về shared.
 */
export * from "../../shared/contract.ts";
