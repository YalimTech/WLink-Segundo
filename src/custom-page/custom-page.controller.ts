//custom-page/custom-page.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as CryptoJS from 'crypto-js';

@Controller('app')
export class CustomPageController {
  constructor(
    private readonly logger: Logger,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Get('whatsapp')
  async getCustomPage(@Res() res: Response) {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', 'frame-ancestors *');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.send(this.generateCustomPageHTML());
  }

  @Post('decrypt-user-data')
  @HttpCode(HttpStatus.OK)
  async decryptUserData(
    @Body() body: { encryptedData: string },
    @Res() res: Response,
  ) {
    try {
      const sharedSecret = this.configService.get<string>('GHL_SHARED_SECRET');
      if (!sharedSecret) {
        return res
          .status(400)
          .json({ error: 'Shared secret not configured on the server.' });
      }

      const decrypted = CryptoJS.AES.decrypt(
        body.encryptedData,
        sharedSecret,
      ).toString(CryptoJS.enc.Utf8);
      const userData = JSON.parse(decrypted);

      this.logger.log('Decrypted user data received.');

      const locationId =
        userData.activeLocation || userData.locationId || userData.companyId;

      if (!locationId) {
        return res
          .status(400)
          .json({ error: 'No location ID found in user data', userData });
      }

      const user = await this.prisma.findUser(locationId);

      return res.json({
        success: true,
        locationId,
        userData,
        user: user
          ? { id: user.id, hasTokens: !!(user.accessToken && user.refreshToken) }
          : null,
      });
    } catch (error) {
      this.logger.error('Error decrypting user data:', error);
      return res
        .status(400)
        .json({ error: 'Failed to decrypt user data', details: error.message });
    }
  }

  private generateCustomPageHTML(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>WLink Bridge - Manager</title>
          <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
          <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
          <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
          <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
        </head>
        <body class="bg-gray-50 p-6">
          <div id="root" class="max-w-3xl mx-auto"></div>
          <script type="text/babel">
            const { useState, useEffect, useRef } = React;
            function App() {
              const [locationId, setLocationId] = useState(null);
              const [encrypted, setEncrypted] = useState(null);
              const [instances, setInstances] = useState([]);
              const [form, setForm] = useState({ instanceId: '', token: '', instanceName: '' });
              const [qr, setQr] = useState('');
              const [showQr, setShowQr] = useState(false);
              const pollRef = useRef(null);
              const mainIntervalRef = useRef(null);

              useEffect(() => {
                const listener = (e) => {
                  if (e.data?.message === 'REQUEST_USER_DATA_RESPONSE') processUser(e.data.payload);
                };
                window.addEventListener('message', listener);
                window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
                return () => window.removeEventListener('message', listener);
              }, []);

              useEffect(() => {
                if (locationId) {
                  loadInstances();
                  if (mainIntervalRef.current) clearInterval(mainIntervalRef.current);
                  mainIntervalRef.current = setInterval(loadInstances, 10000);
                }
                return () => {
                  if (mainIntervalRef.current) clearInterval(mainIntervalRef.current);
                  if (pollRef.current) clearInterval(pollRef.current);
                };
              }, [locationId]);

              async function makeApiRequest(url, options = {}) {
                const res = await fetch(url, {
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json', 'X-GHL-Context': encrypted },
                  ...options,
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'API request failed');
                return data;
              }

              async function processUser(enc) {
                try {
                  const res = await makeApiRequest('/app/decrypt-user-data', { method: 'POST', body: JSON.stringify({ encryptedData: enc }) });
                  setEncrypted(enc);
                  setLocationId(res.locationId);
                } catch (err) {
                  console.error(err);
                }
              }

              async function loadInstances() {
                try {
                  const res = await makeApiRequest('/api/instances');
                  setInstances(res.instances);
                } catch (e) {
                  console.error('Failed to load instances', e);
                }
              }

              async function submit(e) {
                e.preventDefault();
                try {
                  await makeApiRequest('/api/instances', { method: 'POST', body: JSON.stringify({ locationId, ...form }) });
                  setForm({ instanceId: '', token: '', instanceName: '' });
                  await loadInstances();
                } catch (err) {
                  alert(err.message);
                }
              }

              // ✅ CORRECCIÓN: Función startPolling definida
              function startPolling(instanceId) {
                if (pollRef.current) clearInterval(pollRef.current);
                
                pollRef.current = setInterval(async () => {
                  try {
                    console.log('Polling for instance status...');
                    const res = await makeApiRequest('/api/instances');
                    const updatedInstance = res.instances.find(inst => inst.id === instanceId);
                    
                    if (updatedInstance && updatedInstance.state === 'authorized') {
                      console.log('Instance authorized! Stopping poll.');
                      clearInterval(pollRef.current);
                      setShowQr(false);
                      setInstances(res.instances);
                    }
                  } catch (error) {
                    console.error('Polling failed:', error);
                    clearInterval(pollRef.current);
                  }
                }, 3000); // Verifica cada 3 segundos
              }

              async function connectInstance(id) {
                setQr('');
                setShowQr(true);
                if (pollRef.current) clearInterval(pollRef.current); // Detener sondeo anterior

                try {
                  const res = await makeApiRequest('/api/qr/' + id);

                  if (res.type === 'qr') {
                    // ✅ CORRECCIÓN: Asegura que el data URI sea correcto
                    const qrData = res.data.startsWith('data:image') ? res.data : 'data:image/png;base64,' + res.data;
                    setQr(qrData);
                  } else if (res.type === 'code') {
                    const qrImage = await generateQrFromString(res.data);
                    setQr(qrImage);
                  } else {
                    throw new Error('Unexpected QR response format.');
                  }
                  
                  // Esta llamada ahora funcionará
                  startPolling(id);

                } catch (err) {
                  setQr('');
                  setShowQr(false);
                  alert('Error getting QR: ' + err.message);
                }
              }

              async function generateQrFromString(text) {
                return new Promise((resolve, reject) => {
                  if (!window.QRCode) return reject(new Error('QRCode library not loaded'));
                  const container = document.createElement('div');
                  new window.QRCode(container, {
                    text,
                    width: 256,
                    height: 256,
                    correctLevel: window.QRCode.CorrectLevel.H,
                  });
                  setTimeout(() => {
                    const img = container.querySelector('img') || container.querySelector('canvas');
                    if (img) {
                      resolve(img.src || img.toDataURL('image/png'));
                    } else {
                      reject(new Error('Failed to generate QR image'));
                    }
                  }, 100);
                });
              }

              async function logoutInstance(id) {
                if (!confirm('Logout instance?')) return;
                await makeApiRequest('/api/instances/' + id + '/logout', { method: 'DELETE' });
                await loadInstances();
              }

              async function deleteInstance(id) {
                if (!confirm('Delete instance?')) return;
                await makeApiRequest('/api/instances/' + id, { method: 'DELETE' });
                await loadInstances();
              }

              return (
                <div className="space-y-6">
                  <h1 className="text-2xl font-semibold text-center">WLink Bridge Manager</h1>
                  <div className="bg-white rounded-2xl shadow-md p-6 space-y-4">
                    <h2 className="text-xl font-semibold">Your Instances</h2>
                    <div className="space-y-4">
                      {instances.length === 0 && <p className="text-gray-500">No instances added.</p>}
                      
                   {instances.map((inst) => (
  <div key={inst.instanceId} className="flex justify-between items-center p-4 border rounded-xl">
    <div>
      <p className="font-semibold">{inst.name || 'Unnamed'}</p>
      <p className="text-sm text-gray-400">ID local: {inst.id}</p>
      <p className="text-sm text-gray-500">GUID: {inst.idInstance}</p>
      <span
        className={
          "text-xs px-2 py-1 rounded-full " +
          (inst.state === 'authorized' || inst.state === 'connected'
            ? 'bg-green-200 text-green-800'
            : 'bg-yellow-200 text-yellow-800')
        }
      >
        {inst.state === 'authorized' || inst.state === 'connected'
          ? 'Connected'
          : inst.state === 'qr_code' || inst.state === 'open' || inst.state === 'notAuthorized'
          ? 'Awaiting Scan'
          : inst.state}
      </span>
    </div>
    <div className="flex gap-2">
      {inst.state === 'authorized' || inst.state === 'connected' ? (
        <button
          onClick={() => logoutInstance(inst.id)}
          className="px-3 py-1 rounded-xl bg-yellow-500 text-white"
        >
          Logout
        </button>
      ) : (
        <button
          onClick={() => connectInstance(inst.id)}
          className="px-3 py-1 rounded-xl bg-green-600 text-white"
        >
          Connect
        </button>
      )}
      <button
        onClick={() => deleteInstance(inst.id)}
        className="px-3 py-1 rounded-xl bg-red-600 text-white"
      >
        Delete
      </button>
    </div>
  </div>
))}





                    </div>
                  </div>
                  <div className="bg-white rounded-2xl shadow-md p-6 space-y-4">
                    <h2 className="text-xl font-semibold">Add New Instance</h2>
                    <form onSubmit={submit} className="grid gap-4">
                      <input 
                        required 
                        value={form.instanceId} 
                        onChange={(e) => setForm({ ...form, instanceId: e.target.value })} 
                        placeholder="Instance ID (GUID)" 
                        className="border p-2 rounded-xl" 
                      />
                      <input 
                        required 
                        value={form.token} 
                        onChange={(e) => setForm({ ...form, token: e.target.value })} 
                        placeholder="API Token" 
                        className="border p-2 rounded-xl" 
                      />
                      <input 
                        required 
                        value={form.instanceName} 
                        onChange={(e) => setForm({ ...form, instanceName: e.target.value })} 
                        placeholder="Instance Name (e.g., YC2)" 
                        className="border p-2 rounded-xl" 
                      />
                      <button className="px-4 py-2 rounded-xl bg-indigo-600 text-white">Add Instance</button>
                    </form>
                  </div>
                  {showQr && (
                    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center" onClick={() => setShowQr(false)}>
                      <div className="bg-white p-6 rounded-2xl shadow-md text-center space-y-4" onClick={(e) => e.stopPropagation()}>
                        {qr ? <img src={qr} className="mx-auto" /> : <p>Loading QR...</p>}
                        <button onClick={() => { setShowQr(false); if (pollRef.current) clearInterval(pollRef.current); }} className="px-3 py-1 rounded-xl bg-gray-700 text-white">Close</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }
            ReactDOM.render(<App />, document.getElementById('root'));
          </script>
        </body>
      </html>
    `;
  }
}


