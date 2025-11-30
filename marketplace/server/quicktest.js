const express = require('express');
const app = express();
app.get('/marketplace/products/seed', (req,res)=>res.json({ok:true}));
app.listen(8080, ()=>console.log('quicktest listening on 8080'));
