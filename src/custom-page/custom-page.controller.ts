// src/custom-page/custom-page.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException, // Asegúrate de importar UnauthorizedException
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
        this.logger.error('GHL_SHARED_SECRET not configured on the server.'); // LOG
        return res
          .status(400)
          .json({ error: 'Shared secret not configured on the server.' });
      }

      const decrypted = CryptoJS.AES.decrypt(
        body.encryptedData,
        sharedSecret,
      ).toString(CryptoJS.enc.Utf8);

      if (!decrypted) {
        this.logger.warn(
          'GHL context decryption failed. Decrypted content is empty. Check your GHL_SHARED_SECRET.', // LOG
        );
        throw new UnauthorizedException('Invalid GHL context: decryption failed.');
      }

      const userData = JSON.parse(decrypted);

      this.logger.log('Decrypted user data received.'); // LOG

      // ✅ REAFIRMACIÓN: Usar activeLocation como fuente principal
      const locationId = userData.activeLocation;

      if (!locationId) {
        this.logger.warn({
          message: 'No activeLocation property found in decrypted GHL payload.',
          decryptedPayload: userData,
        }); // LOG
        throw new UnauthorizedException('No active location ID in user context');
      }

      const user = await this.prisma.findUser(locationId);
      console.log('User found in DB:', user ? user.id : 'None'); // LOG

      return res.json({
        success: true,
        locationId,
        userData,
        user: user
          ? { id: user.id, hasTokens: !!(user.accessToken && user.refreshToken) }
          : null,
      });
    } catch (error) {
      this.logger.error('Error decrypting user data:', error.stack); // LOG
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or malformed GHL context');
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
              const qrInstanceIdRef = useRef(null); // Para guardar el ID de la instancia cuyo QR se está mostrando

              useEffect(() => {
                const listener = (e) => {
                  if (e.data?.message === 'REQUEST_USER_DATA_RESPONSE') processUser(e.data.payload);
                };
                window.addEventListener('message', listener);
                window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
                // Corregido 'messaage' a 'message' en el cleanup del useEffect
                return () => window.removeEventListener('message', listener);
              }, []);

              useEffect(() => {
                if (locationId) {
                  console.log('LocationId set:', locationId, 'Loading instances...'); // LOG
                  loadInstances();
                  if (mainIntervalRef.current) clearInterval(mainIntervalRef.current);
                  mainIntervalRef.current = setInterval(loadInstances, 10000); // Polling cada 10s para la lista general
                }
                return () => {
                  if (mainIntervalRef.current) clearInterval(mainIntervalRef.current);
                  if (pollRef.current) clearInterval(pollRef.current);
                };
              }, [locationId]);

              async function makeApiRequest(url, options = {}) {
                console.log(\`Making API request to: \${url}\`, options); // LOG
                const res = await fetch(url, {
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json', 'X-GHL-Context': encrypted },
                  ...options,
                });
                // ✅ MEJORA: Manejar errores JSON si la respuesta no es un JSON válido
                let data;
                try {
                  data = await res.json();
                } catch (e) {
                  console.error(\`Error parsing JSON from \${url}. Status: \${res.status} \${res.statusText}\`, e, res); // Log completo de la respuesta
                  throw new Error(res.statusText || 'Invalid JSON response from server');
                }
                if (!res.ok) {
                  console.error(\`API request to \${url} failed. Status: \${res.status}. Response:\`, data); // LOG
                  throw new Error(data.message || 'API request failed');
                }
                console.log(\`API request to \${url} successful. Response:\`, data); // LOG
                return data;
              }

              async function processUser(enc) {
                try {
                  const res = await makeApiRequest('/app/decrypt-user-data', { method: 'POST', body: JSON.stringify({ encryptedData: enc }) });
                  setEncrypted(enc);
                  setLocationId(res.locationId);
                  console.log('User data decrypted and locationId set:', res.locationId); // LOG
                } catch (err) {
                  console.error('Error processing user data:', err); // LOG
                  alert('Failed to load user data. Please ensure the app is installed correctly.');
                }
              }

              async function loadInstances() {
                try {
                  const res = await makeApiRequest('/api/instances');
                  setInstances(res.instances);
                  console.log('Main polling: Instances loaded', res.instances); // LOG: Ver instancias cargadas

                  // ✅ MEJORA: Lógica para cerrar el modal QR desde el polling principal
                  // Esto cubre escenarios donde el polling del QR específico podría haberse detenido
                  // o si el estado cambia por un webhook mientras el modal está abierto.
                  if (showQr && qrInstanceIdRef.current) {
                    const currentQrInstance = res.instances.find(inst => String(inst.id) === String(qrInstanceIdRef.current)); // ✅ Usar String() para comparación segura de BigInt
                    console.log('Main polling: Current QR instance state for QR modal:', currentQrInstance?.state); // LOG: Estado del QR en el polling principal

                    // Si la instancia asociada al QR ya no es 'qr_code' o 'starting'
                    if (currentQrInstance && currentQrInstance.state !== 'qr_code' && currentQrInstance.state !== 'starting') {
                      console.log(\`Main polling: Closing QR modal as state is now \${currentQrInstance.state}. \`);
                      clearInterval(pollRef.current); // Detener polling del QR si estaba activo
                      pollRef.current = null;
                      setShowQr(false);
                      setQr('');
                      qrInstanceIdRef.current = null;
                    } else if (!currentQrInstance) {
                      // ✅ MEJORA: Si la instancia del QR ya no existe (ej. fue eliminada del backend)
                      console.log('Main polling: Closing QR modal as instance no longer exists in backend data.');
                      clearInterval(pollRef.current);
                      pollRef.current = null;
                      setShowQr(false);
                      setQr('');
                      qrInstanceIdRef.current = null;
                    }
                  }
                } catch (e) {
                  console.error('Failed to load instances in main polling', e); // LOG
                }
              }

              async function submit(e) {
                e.preventDefault();
                try {
                  const newInstanceData = { locationId, ...form };
                  console.log('Submitting new instance:', newInstanceData); // LOG
                  await makeApiRequest('/api/instances', { method: 'POST', body: JSON.stringify(newInstanceData) });
                  setForm({ instanceId: '', token: '', instanceName: '' }); // Limpiar el formulario
                  await loadInstances();
                  alert('Instance added successfully!');
                } catch (err) {
                  console.error('Error adding instance:', err); // LOG
                  alert(err.message);
                }
              }

              // ===============================================
              // ✅ LÓGICA DE POLLING DEL QR REFINADA
              // ===============================================
              function startPolling(instanceId) {
                // Asegurarse de que solo un sondeo se ejecute por QR a la vez
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  console.log('Cleared previous QR polling interval.'); // LOG
                }
                qrInstanceIdRef.current = instanceId; // Guarda el ID de la instancia cuyo QR se está mostrando
                
                pollRef.current = setInterval(async () => {
                  try {
                    const res = await makeApiRequest('/api/instances');
                    // ✅ Usar String() para comparación segura de BigInt.
                    // Esto es CRÍTICO si los IDs de Prisma son BigInt y se serializan a string en JSON.
                    const updatedInstance = res.instances.find(inst => String(inst.id) === String(instanceId)); 
                    
                    console.log(\`QR polling for \${instanceId}: Fetched state \${updatedInstance?.state}\`); // LOG: Estado específico del QR

                    if (updatedInstance) {
                      setInstances(res.instances); // Siempre actualiza la lista para reflejar el estado más reciente

                      // ✅ Condición para detener el polling y cerrar el modal.
                      // Si el estado NO es 'qr_code' Y NO es 'starting', entonces cerramos el modal.
                      // Esto cubre 'authorized', 'notAuthorized', 'blocked', 'yellowCard'.
                      if (updatedInstance.state !== 'qr_code' && updatedInstance.state !== 'starting') {
                        console.log(\`QR polling: State \${updatedInstance.state} detected, closing QR modal.\`);
                        clearInterval(pollRef.current);
                        pollRef.current = null; // Asegura que la referencia se limpie
                        setShowQr(false);
                        setQr('');
                        qrInstanceIdRef.current = null; // Limpiar el ID de la instancia del QR
                      }
                      // No necesitamos una condición 'if (updatedInstance.state === 'authorized')' separada aquí,
                      // ya que la condición superior ya lo maneja de forma más general.
                    } else {
                      // ✅ MEJORA: Si la instancia ya no se encuentra (ej. fue eliminada del backend)
                      console.log(\`QR polling: Instance \${instanceId} not found in fetched data, stopping polling and closing QR.\`);
                      clearInterval(pollRef.current);
                      pollRef.current = null;
                      setShowQr(false);
                      setQr('');
                      qrInstanceIdRef.current = null;
                    }
                  } catch (error) {
                    console.error('Error during QR polling:', error); // LOG
                    // ✅ MEJORA: En caso de error en el polling del QR, también cerramos el modal
                    // para evitar que se quede atascado y limpiamos el polling.
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    setShowQr(false);
                    setQr('');
                    qrInstanceIdRef.current = null;
                  }
                }, 2000); // ✅ MEJORA: Sondea un poco más rápido (cada 2 segundos) para transiciones rápidas
              }

              async function connectInstance(id) {
                setQr(''); // Limpiar cualquier QR previo
                setShowQr(true); // Mostrar el modal del QR inmediatamente
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  console.log('Cleared previous polling before new QR request.'); // LOG
                }
                qrInstanceIdRef.current = id; // Asignar el ID de la instancia al ref para el QR

                try {
                  console.log(\`Attempting to fetch QR for instance ID: \${id}\`); // LOG
                  // La petición para obtener el QR / iniciar conexión
                  const res = await makeApiRequest('/api/qr/' + id);
                  console.log(\`QR API response for \${id}:\`, res); // LOG: Respuesta del QR completa

                  if (res.type === 'qr') {
                    const qrData = res.data.startsWith('data:image') ? res.data : 'data:image/png;base64,' + res.data;
                    setQr(qrData);
                    console.log('QR data set to state.'); // LOG
                  } else if (res.type === 'code') {
                    const qrImage = await generateQrFromString(res.data);
                    setQr(qrImage);
                    console.log('Pairing code QR image generated and set to state.'); // LOG
                  } else {
                    throw new Error('Unexpected QR response format. Type was: ' + res.type);
                  }
                  
                  // Iniciar el sondeo para el estado de la instancia inmediatamente después de obtener el QR
                  startPolling(id);

                } catch (err) {
                  console.error('Error obtaining QR:', err); // LOG detallado
                  setQr('');
                  setShowQr(false); // Asegurarse de que el modal se cierre si la petición de QR falla.
                  qrInstanceIdRef.current = null; // Limpiar el ID de la instancia del QR
                  alert('Error obteniendo QR: ' + err.message);
                }
              }

              async function generateQrFromString(text) {
                return new Promise((resolve, reject) => {
                  if (!window.QRCode) {
                    console.error('QRCode library not loaded!'); // LOG
                    return reject(new Error('QRCode library not loaded'));
                  }
                  const container = document.createElement('div');
                  new window.QRCode(container, {
                    text,
                    width: 256,
                    height: 256,
                    correctLevel: window.QRCode.CorrectLevel.H,
                  });
                  // Pequeño retraso para asegurar que el QR se renderiza en el canvas/img antes de capturar
                  setTimeout(() => {
                    const img = container.querySelector('img') || container.querySelector('canvas');
                    if (img) {
                      const dataUrl = img.src || img.toDataURL('image/png');
                      console.log('Generated QR from string successfully.'); // LOG
                      resolve(dataUrl);
                    } else {
                      console.error('Failed to find QR image in container after generation.'); // LOG
                      reject(new Error('Failed to generate QR image'));
                    }
                  }, 100);
                });
              }

              async function logoutInstance(id) {
                if (!confirm('¿Desconectar instancia?')) return;
                try {
                  console.log(\`Attempting to logout instance ID: \${id}\`); // LOG
                  await makeApiRequest('/api/instances/' + id + '/logout', { method: 'DELETE' });
                  console.log(\`Instance \${id} logout command sent successfully. Reloading instances...\`); // LOG
                  // Tras el logout, recargar instancias. El polling principal se encargará de actualizar el estado.
                  await loadInstances(); 
                  alert('Instance logout command sent. State will update shortly.');
                } catch (err) {
                  console.error('Error disconnecting instance:', err); // LOG
                  alert('Error al desconectar: ' + err.message);
                }
              }

              async function deleteInstance(id) {
                if (!confirm('¿Eliminar instancia permanentemente?')) return;
                try {
                  console.log(\`Attempting to delete instance ID: \${id}\`); // LOG
                  await makeApiRequest('/api/instances/' + id, { method: 'DELETE' });
                  console.log(\`Instance \${id} delete command sent. Reloading instances...\`); // LOG
                  await loadInstances(); // Recargar instancias para reflejar la eliminación
                  alert('Instance deletion command sent. Panel will update shortly.');
                } catch (err) {
                  console.error('Error deleting instance:', err); // LOG
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
                                  ? 'bg-green-200 text-green-800' // Conectado y autorizado
                                  : inst.state === 'qr_code' || inst.state === 'starting'
                                  ? 'bg-yellow-200 text-yellow-800' // Esperando acción (QR) o iniciando
                                  : inst.state === 'notAuthorized'
                                  ? 'bg-red-200 text-red-800' // Desconectado (rojo para mayor visibilidad)
                                  : inst.state === 'yellowCard' || inst.state === 'blocked'
                                  ? 'bg-red-500 text-white' // Estados de error o bloqueado (más oscuro)
                                  : 'bg-gray-200 text-gray-800') // Para cualquier otro estado no mapeado
                              }
                            >
                              {/* =============================================== */}
                              {/* ✅ VISUALIZACIÓN DEL ESTADO (FINAL) */}
                              {/* =============================================== */}
                              {
                                // Muestra "Awaiting Scan" solo si el modal de QR está abierto y es para esta instancia.
                                // Comparamos los IDs como strings para evitar problemas de BigInt.
                                showQr && String(qrInstanceIdRef.current) === String(inst.id) && (inst.state === 'qr_code' || inst.state === 'starting')
                                  ? 'Awaiting Scan'
                                  : inst.state === 'authorized'
                                  ? 'Connected'
                                  : inst.state === 'notAuthorized'
                                  ? 'Disconnected'
                                  : inst.state === 'qr_code'
                                  ? 'Awaiting Scan (Background)' // Si el backend reporta QR pero el modal no está abierto activamente para él
                                  : inst.state === 'starting'
                                  ? 'Connecting...'
                                  : inst.state === 'yellowCard' || inst.state === 'blocked'
                                  ? 'Error / Blocked'
                                  : inst.state || 'Unknown' // Mostrar el estado tal cual si no hay mapeo específico
                              }
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {inst.state === 'authorized' ? ( // Solo 'authorized' debe poder desconectarse (hacer logout)
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
                    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center" 
                         onClick={() => { 
                           console.log('Overlay clicked: Closing QR modal.'); // LOG: Cierre por overlay
                           setShowQr(false); 
                           if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                           setQr(''); 
                           qrInstanceIdRef.current = null; // Limpiar el ID de la instancia del QR
                         }}>
                      <div className="bg-white p-6 rounded-2xl shadow-md text-center space-y-4" onClick={(e) => e.stopPropagation()}>
                        {qr ? <img src={qr} className="mx-auto" /> : <p>Loading QR...</p>}
                        <button onClick={() => { 
                          console.log('Close button clicked: Closing QR modal.'); // LOG: Cierre por botón
                          setShowQr(false); 
                          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                          setQr(''); 
                          qrInstanceIdRef.current = null; // Limpiar el ID de la instancia del QR
                        }} className="px-3 py-1 rounded-xl bg-gray-700 text-white">Close</button>
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
