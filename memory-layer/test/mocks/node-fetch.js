
module.exports = {
  default: function() {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('')
    });
  },
  Headers: class {},
  Request: class {},
  Response: class {}
};
