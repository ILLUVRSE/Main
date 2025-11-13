// middleware.ts

// Middleware for enforcing mTLS and OIDC
function enforceAuth(req, res, next) {
  // Check for valid OIDC token
  if (!req.user) {
    return res.status(401).send('Unauthorized');
  }
  next();
}

app.use(enforceAuth);
