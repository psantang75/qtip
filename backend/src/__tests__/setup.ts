// Shared test setup — load env so `pool` connects to the same dev DB the
// app uses. Tests are read-only against the golden slice and load the
// edge-case fixtures via SQL transactions that they roll back / clean up.
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') })
