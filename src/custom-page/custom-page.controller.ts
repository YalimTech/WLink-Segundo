//src/custom-page/custom-page.controller.ts
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
                return () => window.removeEventListener('messaage', listener);
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
                  setForm({ instanceId: '', token: '', instanceName: '' }); // Limpiar el formulario
                  await loadInstances();
                } catch (err) {
                  alert(err.message);
                }
              }

              // ===============================================
              // ✅ MODIFICACIÓN CLAVE EN LA LÓGICA DE POLLING
              // ===============================================
              function startPolling(instanceId) {
                // Limpiar cualquier sondeo previo para evitar múltiples intervalos
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null; // Resetear la referencia
                }
                
                pollRef.current = setInterval(async () => {
                  try {
                    const res = await makeApiRequest('/api/instances');
                    const updatedInstance = res.instances.find(inst => inst.id === instanceId);
                    
                    if (updatedInstance) {
                      setInstances(res.instances); // Siempre actualiza la lista para reflejar el estado más reciente

                      // Si el estado es 'authorized' o 'notAuthorized', detenemos el sondeo y cerramos el QR
                      if (updatedInstance.state === 'authorized' || updatedInstance.state === 'notAuthorized' || updatedInstance.state === 'blocked' || updatedInstance.state === 'yellowCard') {
                        clearInterval(pollRef.current);
                        pollRef.current = null;
                        setShowQr(false); // Cerrar el modal del QR
                        setQr(''); // Limpiar el QR para que no se muestre el viejo si se abre de nuevo
                        console.log('Polling stopped, QR closed, instance is now:', updatedInstance.state);
                      }
                    } else {
                      // Si la instancia ya no se encuentra (ej. fue eliminada), detener el sondeo.
                      clearInterval(pollRef.current);
                      pollRef.current = null;
                      setShowQr(false);
                      setQr('');
                      console.log('Polling stopped, instance not found.');
                    }
                  } catch (error) {
                    console.error('Error during polling:', error);
                    clearInterval(pollRef.current); // Detener el sondeo si hay un error
                    pollRef.current = null;
                    setShowQr(false); // Cerrar el modal QR si el sondeo falla
                    setQr('');
                  }
                }, 3000); // Sondea cada 3 segundos
              }

              async function connectInstance(id) {
                setQr(''); // Limpiar cualquier QR previo
                setShowQr(true); // Mostrar el modal del QR inmediatamente
                if (pollRef.current) clearInterval(pollRef.current); // Detener sondeo anterior si lo hay

                try {
                  // La petición para obtener el QR / iniciar conexión
                  const res = await makeApiRequest('/api/qr/' + id);

                  if (res.type === 'qr') {
                    const qrData = res.data.startsWith('data:image') ? res.data : 'data:image/png;base64,' + res.data;
                    setQr(qrData);
                  } else if (res.type === 'code') {
                    const qrImage = await generateQrFromString(res.data);
                    setQr(qrImage);
                  } else {
                    throw new Error('Unexpected QR response format.');
                  }
                  
                  // Iniciar el sondeo para el estado de la instancia
                  startPolling(id);

                } catch (err) {
                  setQr('');
                  setShowQr(false); // Asegurarse de que el modal se cierre si la petición de QR falla.
                  alert('Error obteniendo QR: ' + err.message);
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
                if (!confirm('¿Desconectar instancia?')) return;
                try {
                  await makeApiRequest('/api/instances/' + id + '/logout', { method: 'DELETE' });
                  // Tras el logout, es crucial que el polling actualice el estado a 'notAuthorized'
                  await loadInstances(); 
                } catch (err) {
                  alert('Error al desconectar: ' + err.message);
                }
              }

              async function deleteInstance(id) {
                if (!confirm('¿Eliminar instancia permanentemente?')) return;
                try {
                  await makeApiRequest('/api/instances/' + id, { method: 'DELETE' });
                  await loadInstances();
                } catch (err) {
                  alert('Error al eliminar: ' + err.message);
                }
              }

              return (
                <div className="space-y-6">
                  <h1 className="text-2xl font-semibold text-center">WLink Bridge Manager</h1>
                  <div className="bg-white rounded-2xl shadow-md p-6 space-y-4">
                    <h2 className="text-xl font-semibold">Your Instances</h2>
                    <div className="space-y-4">
                      {instances.length === 0 && <p className="text-gray-500">No instances added.</p>}
                      
                      {instances.map((inst) => (
                        <div key={inst.id} className="flex justify-between items-center p-4 border rounded-xl">
                          <div>
                            <p className="font-semibold">{inst.name || 'Unnamed'}</p>
                            <p className="text-sm text-gray-400">ID local: {inst.id}</p>
                            <p className="text-sm text-gray-500">GUID: {inst.guid}</p>
                            <span
                              className={
                                "text-xs px-2 py-1 rounded-full " +
                                (inst.state === 'authorized'
                                  ? 'bg-green-200 text-green-800'
                                  : inst.state === 'qr_code' || inst.state === 'starting'
                                  ? 'bg-yellow-200 text-yellow-800'
                                  : inst.state === 'notAuthorized'
                                  ? 'bg-red-200 text-red-800'
                                  : inst.state === 'yellowCard' || inst.state === 'blocked'
                                  ? 'bg-red-500 text-white'
                                  : 'bg-gray-200 text-gray-800')
                              }
                            >
                              {/* =============================================== */}
                              {/* ✅ MODIFICACIÓN CLAVE EN LA VISUALIZACIÓN DEL ESTADO */}
                              {/* =============================================== */}
                              {inst.state === 'authorized'
                                ? 'Connected'
                                : inst.state === 'qr_code'
                                ? 'Awaiting Scan' // Opcional: Si el modal QR está visible y el estado es qr_code, puedes mostrar "Awaiting Scan". Si no, simplemente el estado del backend.
                                : inst.state === 'starting'
                                ? 'Connecting...'
                                : inst.state === 'notAuthorized'
                                ? 'Disconnected'
                                : inst.state === 'yellowCard' || inst.state === 'blocked'
                                ? 'Error / Blocked'
                                : inst.state || 'Unknown'}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {inst.state === 'authorized' ? (
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
                      {/* MANTENEMOS EL CAMPO 'Instance ID (GUID)' ya que es requerido por el backend para la validación */}
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
                    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center" onClick={() => { setShowQr(false); if (pollRef.current) clearInterval(pollRef.current); setQr(''); }}>
                      <div className="bg-white p-6 rounded-2xl shadow-md text-center space-y-4" onClick={(e) => e.stopPropagation()}>
                        {qr ? <img src={qr} className="mx-auto" /> : <p>Loading QR...</p>}
                        <button onClick={() => { setShowQr(false); if (pollRef.current) clearInterval(pollRef.current); setQr(''); }} className="px-3 py-1 rounded-xl bg-gray-700 text-white">Close</button>
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
