module.exports = async function handler(req, res) {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "";
  if (!publicKey) {
    return res.status(500).json({ error: "WEB_PUSH_PUBLIC_KEY is not set" });
  }
  return res.status(200).json({ publicKey });
};
