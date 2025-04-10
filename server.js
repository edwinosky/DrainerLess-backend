const express = require('express');
const https = require('https');
const fs = require('fs');
const mysql = require('mysql2/promise');
const cors = require('cors');
const winston = require('winston');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Configuración de Winston
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'server.log' })
  ]
});

// Configuración de la base de datos
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool;
const initializeDatabase = async () => {
  try {
    pool = await mysql.createPool(dbConfig);
    const [rows] = await pool.execute('SELECT 1 + 1 AS test');
    logger.info(`Conexión exitosa a la base de datos ${dbConfig.database}. Test: ${rows[0].test}`);

    const [indexCheckContracts] = await pool.execute(
      "SHOW INDEX FROM contracts WHERE Key_name = 'idx_owner'"
    );
    if (indexCheckContracts.length === 0) {
      await pool.execute('CREATE INDEX idx_owner ON contracts (owner)');
      logger.info('Índice idx_owner creado en contracts');
    } else {
      logger.info('Índice idx_owner ya existe en contracts');
    }

    const [indexCheckTransactions] = await pool.execute(
      "SHOW INDEX FROM transactions WHERE Key_name = 'idx_contract_address'"
    );
    if (indexCheckTransactions.length === 0) {
      await pool.execute('CREATE INDEX idx_contract_address ON transactions (contract_address)');
      logger.info('Índice idx_contract_address creado en transactions');
    } else {
      logger.info('Índice idx_contract_address ya existe en transactions');
    }
  } catch (error) {
    logger.error(`Error al conectar a la base de datos: ${error.message}`);
    process.exit(1);
  }
};

// Middleware para registrar peticiones
app.use((req, res, next) => {
  logger.info(`Petición recibida: ${req.method} ${req.url} desde ${req.ip}`);
  next();
});

// Endpoints
app.post('/contracts', async (req, res) => {
  try {
    const { address, token, wallets, owner } = req.body;
    logger.info(`Añadiendo contrato: ${address} para ${owner}`);
    const [result] = await pool.execute(
      'INSERT INTO contracts (address, token, wallets, owner) VALUES (?, ?, ?, ?)',
      [address, token, JSON.stringify(wallets), owner]
    );
    logger.info(`Contrato ${address} añadido exitosamente`);
    res.status(201).json({ message: 'Contrato añadido', address });
  } catch (error) {
    logger.error(`Error al añadir contrato: ${error.message}`);
    res.status(500).json({ error: 'Error al añadir contrato' });
  }
});

app.get('/contracts/:owner', async (req, res) => {
  try {
    const owner = req.params.owner;
    logger.info(`Obteniendo contratos para el propietario: ${owner}`);
    console.time(`getContracts_${owner}`); // Iniciar medición
    const [rows] = await pool.execute('SELECT address, token, wallets FROM contracts WHERE owner = ?', [owner]);
    const contracts = rows.map(row => ({ ...row, wallets: JSON.parse(row.wallets) }));
    console.timeEnd(`getContracts_${owner}`); // Finalizar medición
    logger.info(`Encontrados ${contracts.length} contratos para ${owner}`);
    res.json(contracts);
  } catch (error) {
    logger.error(`Error al obtener contratos: ${error.message}`);
    res.status(500).json({ error: 'Error al obtener contratos' });
  }
});

app.post('/transactions', async (req, res) => {
  try {
    const { contractAddress, type, details, timestamp } = req.body;
    logger.info(`Añadiendo transacción para el contrato: ${contractAddress}`);
    const [result] = await pool.execute(
      'INSERT INTO transactions (contract_address, type, details, timestamp) VALUES (?, ?, ?, ?)',
      [contractAddress, type, details, timestamp]
    );
    logger.info(`Transacción añadida para ${contractAddress}`);
    res.status(201).json({ message: 'Transacción añadida' });
  } catch (error) {
    logger.error(`Error al añadir transacción: ${error.message}`);
    res.status(500).json({ error: 'Error al añadir transacción' });
  }
});

app.get('/transactions/:contractAddress', async (req, res) => {
  try {
    const contractAddress = req.params.contractAddress;
    logger.info(`Obteniendo transacciones para el contrato: ${contractAddress}`);
    console.time(`getTransactions_${contractAddress}`);
    const [rows] = await pool.execute('SELECT * FROM transactions WHERE contract_address = ?', [contractAddress]);
    console.timeEnd(`getTransactions_${contractAddress}`);
    logger.info(`Encontradas ${rows.length} transacciones para ${contractAddress}`);
    res.json(rows);
  } catch (error) {
    logger.error(`Error al obtener transacciones: ${error.message}`);
    res.status(500).json({ error: 'Error al obtener transacciones' });
  }
});

app.post('/rescues', async (req, res) => {
  try {
    const { owner, type, contractAddress, amount, tokenIds, timestamp } = req.body;
    logger.info(`Añadiendo rescate para ${owner} en contrato ${contractAddress}`);
    const [result] = await pool.execute(
      'INSERT INTO rescues (owner, type, contract_address, amount, token_ids, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [owner, type, contractAddress, amount, tokenIds ? JSON.stringify(tokenIds) : null, timestamp]
    );
    logger.info(`Rescate añadido para ${contractAddress}`);
    res.status(201).json({ message: 'Rescate añadido' });
  } catch (error) {
    logger.error(`Error al añadir rescate: ${error.message}`);
    res.status(500).json({ error: 'Error al añadir rescate' });
  }
});

app.get('/rescues/:owner', async (req, res) => {
  try {
    const owner = req.params.owner;
    logger.info(`Obteniendo rescates para el propietario: ${owner}`);
    console.time(`getRescues_${owner}`);
    const [rows] = await pool.execute('SELECT * FROM rescues WHERE owner = ?', [owner]);
    const rescues = rows.map(row => ({ ...row, token_ids: row.token_ids ? JSON.parse(row.token_ids) : null }));
    console.timeEnd(`getRescues_${owner}`);
    logger.info(`Encontrados ${rescues.length} rescates para ${owner}`);
    res.json(rescues);
  } catch (error) {
    logger.error(`Error al obtener rescates: ${error.message}`);
    res.status(500).json({ error: 'Error al obtener rescates' });
  }
});

// Configuración de certificados SSL
const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/db.cryptomissis.xyz/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/db.cryptomissis.xyz/fullchain.pem')
};

// Iniciar el servidor HTTPS
const PORT = process.env.PORT || 3111;
const startServer = async () => {
  try {
    await initializeDatabase();
    const server = https.createServer(sslOptions, app);
    server.listen(PORT, () => {
      logger.info(`Servidor corriendo en el puerto HTTPS ${PORT}`);
    });
    server.on('error', (err) => {
      logger.error(`Error en el servidor HTTPS: ${err.message}`);
    });
  } catch (error) {
    logger.error(`Error al iniciar el servidor: ${error.message}`);
  }
};

startServer();
