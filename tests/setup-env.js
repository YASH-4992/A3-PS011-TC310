process.env.NODE_ENV = 'test';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'strongpassword123';
process.env.SESSION_SECRET = 'supersecretkeywith16chars';
process.env.SESSION_TTL_MINUTES = '60';
process.env.PORT = '3001';
process.env.MONGODB_URI = 'mongodb://localhost:27017/aiori_test';
process.env.LOG_LEVEL = 'error';
// For the scope gate: in tests we use 127.0.0.1/32 as the authorized range.
process.env.SCOPE_CIDRS = '127.0.0.1/32';
