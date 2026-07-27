// `server-only` throws when imported outside a React Server Component.
// CLI scripts legitimately import the same data modules, so tsconfig.scripts.json
// aliases the package to this no-op.
export {};
