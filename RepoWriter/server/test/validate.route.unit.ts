// New test case for handling invalid input in validate route
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from 'supertest';
import app from '../src/app'; // Assuming the Express app is exported from this path

describe("POST /api/validate", () => {
  it("should return 400 for invalid input", async () => {
    const response = await request(app)
      .post('/api/validate')
      .send({ patches: [{ path: "", content: "" }] }); // Invalid input
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });
});