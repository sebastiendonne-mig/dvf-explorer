import './helpers/hermetic';
import { APICallError, RetryError } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VALID_BODY, runChat } from './helpers/chat';
import { errorLogFields, log } from '@/lib/log';

const TEMOIN = 'chaine-temoin-journal';

vi.mock('@/lib/terrain-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/terrain-data')>()),
  fetchTerrainSales: vi.fn(async () => {
    throw new Error(`https://files.data.gouv.fr/${TEMOIN}.csv introuvable`);
  }),
}));

function apiError(statusCode: number, isRetryable = false) {
  return new APICallError({
    message: `${TEMOIN} message fournisseur`,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: { messages: [{ role: 'user', content: TEMOIN }] },
    statusCode,
    responseBody: `{"error":{"message":"${TEMOIN}"}}`,
    isRetryable,
  });
}

function spyConsole() {
  return (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
}

afterEach(() => vi.restoreAllMocks());

describe('lib/log', () => {
  it('écrit une ligne JSON par événement, sur la sortie du niveau', () => {
    const [, , warn, error] = spyConsole();
    log('warn', 'evt', { a: 1, b: 'x', c: undefined });
    log('error', 'evt2');
    expect(warn).toHaveBeenCalledWith('{"level":"warn","event":"evt","a":1,"b":"x"}');
    expect(error).toHaveBeenCalledWith('{"level":"error","event":"evt2"}');
  });

  it('errorLogFields : nom, statut, réessayable — jamais message, corps ni requête', () => {
    const fields = errorLogFields(apiError(529, true));
    expect(fields).toEqual({
      name: 'AI_APICallError', retryReason: undefined, innerName: undefined, statusCode: 529, isRetryable: true,
    });
    expect(JSON.stringify(fields)).not.toContain(TEMOIN);
  });

  it('errorLogFields déballe un RetryError (lastError)', () => {
    const wrapped = new RetryError({ message: TEMOIN, reason: 'maxRetriesExceeded', errors: [apiError(429, true), apiError(429, true)] });
    const fields = errorLogFields(wrapped);
    expect(fields).toMatchObject({ name: 'AI_RetryError', retryReason: 'maxRetriesExceeded', innerName: 'AI_APICallError', statusCode: 429 });
    expect(JSON.stringify(fields)).not.toContain(TEMOIN);
  });
});

describe('handleChat — onError', () => {
  it('journalise model_error avec nom et statut seulement', async () => {
    const { deps } = await runChat(VALID_BODY, [apiError(400)]);
    expect(deps.log).toHaveBeenCalledWith('error', 'model_error', expect.objectContaining({
      name: 'AI_APICallError', statusCode: 400, isRetryable: false,
    }));
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain(TEMOIN);
  });

  it("remplace le console.error(error) par défaut du SDK", async () => {
    const spies = spyConsole();
    await runChat(VALID_BODY, [apiError(400)]);
    for (const spy of spies) {
      for (const args of spy.mock.calls) {
        expect(args.some((a) => a instanceof Error)).toBe(false);
      }
    }
  });
});

describe('/api/terrain-transactions — journal', () => {
  it("ne journalise que le nom de l'erreur", async () => {
    const spies = spyConsole();
    const { GET } = await import('@/app/api/terrain-transactions/route');
    const res = await GET(new Request('http://localhost/api/terrain-transactions?insee=34301&category=terrains%20a%20b%C3%A2tir'));
    expect(res.status).toBe(500);
    const error = spies[3];
    expect(error).toHaveBeenCalledWith('{"level":"error","event":"terrain_transactions_error","name":"Error"}');
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(TEMOIN);
  });
});
