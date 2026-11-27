import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPLIED_MIGRATIONS_VERSION,
  MIGRATIONS_DIR,
  migrationVersions,
  missingMigrations,
} from './migrations.ts';

describe('migrationVersions', () => {
  it('reads the repo migrations, oldest first, including applied_migrations()', () => {
    const versions = migrationVersions(MIGRATIONS_DIR);
    expect(versions.length).toBeGreaterThan(20);
    expect(versions).toEqual([...versions].sort());
    expect(versions).toContain(APPLIED_MIGRATIONS_VERSION);
    expect(versions).toContain('20261126090000');
  });

  it('ignores files that are not dbmate migrations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'naqdpos-migrations-'));
    for (const name of ['20261127090000_b.sql', '20261120090000_a.sql', 'README.md', 'x.sql']) {
      writeFileSync(join(dir, name), '');
    }
    expect(migrationVersions(dir)).toEqual(['20261120090000', '20261127090000']);
  });
});

describe('missingMigrations', () => {
  it('lists expected versions the database has not applied (staging, 26 Nov)', () => {
    expect(
      missingMigrations(['20261124090000', '20261125090000', '20261126090000'], ['20261124090000']),
    ).toEqual(['20261125090000', '20261126090000']);
  });

  it('is empty when the database is up to date or ahead of the API', () => {
    expect(missingMigrations(['1', '2'], ['1', '2'])).toEqual([]);
    expect(missingMigrations(['1', '2'], ['1', '2', '3'])).toEqual([]);
  });
});
