/**
 * Tests compare the API with the frontend's fixture, which reads Vite's import.meta.env. Under vitest it exists;
 * declare it so tsc accepts it.
 */
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
