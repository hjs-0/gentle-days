// Local development only: node server.js (or npm run dev)
const app = require('./app');
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Gentle Days running at http://localhost:${port}`));
