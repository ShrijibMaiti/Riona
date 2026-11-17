/**
 * Types shared by the frontend and the backend.
 *
 * For now the domain types live in the frontend (frontend/app/src/data/types), which is where the API contract was
 * written, and are re-exported from here so the backend can import them as `@riona/shared`. When the backend
 * owns the contract, move that file into this package and point the frontend at it instead.
 */
export type * from '../../../frontend/app/src/data/types/index';
export * from './errors';