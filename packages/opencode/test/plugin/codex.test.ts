import { describe, expect, test } from "bun:test"
import {
  applyCodexOAuthModelLimits,
  chatgptSubscriptionLimit,
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  type IdTokenClaims,
} from "../../src/plugin/codex"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

function createOpenAIModel(id: string, limit: Provider.Model["limit"]): Provider.Model {
  return {
    id: ModelID.make(id),
    providerID: ProviderID.make("openai"),
    name: id,
    family: "gpt",
    api: { id, url: "", npm: "@ai-sdk/openai" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    limit,
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

describe("plugin.codex", () => {
  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })

  describe("ChatGPT subscription limits", () => {
    test("defaults to the ChatGPT Pro/Plus OAuth input cap", () => {
      // 258_000 = OpenAI documented 272k input minus the ~5% Codex client reserves internally.
      // See inline comment on CHATGPT_SUBSCRIPTION_DEFAULT_LIMIT in plugin/codex.ts.
      expect(chatgptSubscriptionLimit()).toEqual({ context: 400_000, input: 258_000, output: 128_000 })
    })

    test("patches OpenAI OAuth models away from API/catalog 1M limits", () => {
      const provider = {
        models: {
          "gpt-5.4": createOpenAIModel("gpt-5.4", { context: 1_050_000, input: 922_000, output: 128_000 }),
          "gpt-5.5": createOpenAIModel("gpt-5.5", { context: 1_050_000, input: 922_000, output: 128_000 }),
        },
      }

      applyCodexOAuthModelLimits(provider)

      expect(provider.models["gpt-5.4"].limit).toEqual({ context: 400_000, input: 258_000, output: 128_000 })
      expect(provider.models["gpt-5.5"].limit).toEqual({ context: 400_000, input: 258_000, output: 128_000 })
    })

    test("does not patch non-OpenAI providers", () => {
      const model = createOpenAIModel("gpt-5.4", { context: 1_050_000, input: 922_000, output: 128_000 })
      model.providerID = ProviderID.make("openrouter")
      const provider = { models: { "openai/gpt-5.4": model } }

      applyCodexOAuthModelLimits(provider)

      expect(provider.models["openai/gpt-5.4"].limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
    })
  })
})
