/**
 * Test preload (bunfig.toml [test] preload): install the module slots before
 * any test file imports the modules they stand in for, so every file's
 * overrides are live at its own tests and a previous file's fakes never bind
 * for good (see module-slots.ts).
 */
import { installModuleSlots } from './module-slots'

await installModuleSlots()
