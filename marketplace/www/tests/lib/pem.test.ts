import { validatePublicKeyPem } from "@/lib/pem";

describe("validatePublicKeyPem", () => {
  it("accepts valid RSA public keys", () => {
    const pem = `-----BEGIN PUBLIC KEY-----\nAAAAB3NzaC1yc2EAAAADAQABAAABAQD\n-----END PUBLIC KEY-----`;
    expect(validatePublicKeyPem(pem)).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(validatePublicKeyPem("not-a-key")).toBe(false);
  });
});
