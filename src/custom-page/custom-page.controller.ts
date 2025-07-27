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
  UnauthorizedException,
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
    // Configuración de encabezados para permitir el iframing y CORS
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
        this.logger.error('GHL_SHARED_SECRET not configured on the server.');
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
          'GHL context decryption failed. Decrypted content is empty. Check your GHL_SHARED_SECRET.',
        );
        throw new UnauthorizedException('Invalid GHL context: decryption failed.');
      }

      const userData = JSON.parse(decrypted);

      this.logger.log('Decrypted user data received.');

      const locationId = userData.activeLocation;

      if (!locationId) {
        this.logger.warn({
          message: 'No activeLocation property found in decrypted GHL payload.',
          decryptedPayload: userData,
        });
        throw new UnauthorizedException('No active location ID in user context');
      }

      const user = await this.prisma.findUser(locationId);
      console.log('User found in DB:', user ? user.id : 'None');

      return res.json({
        success: true,
        locationId,
        userData, // Pass the full userData object
        user: user
          ? { id: user.id, hasTokens: !!(user.accessToken && user.refreshToken) }
          : null,
      });
    } catch (error) {
      this.logger.error('Error decrypting user data:', error.stack);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or malformed GHL context');
    }
  }

  /**
   * Genera el HTML completo para la página de gestión de instancias de WhatsApp.
   * Incluye la aplicación React con toda la lógica de UI y llamadas a la API.
   *
   * ✅ Cambios para que la estructura sea casi igual a la imagen de ejemplo:
   * - Se añadió la sección "Connection Status" con datos mock.
   * - El nombre de la instancia en la tarjeta ya no es editable.
   * - Se añadió el botón "Open Console".
   * - El botón "Logout" se muestra si la instancia está 'authorized', de lo contrario, se muestra "Connect".
   * - El estado de la instancia se muestra de forma más prominente.
   * - Se ajustaron los estilos para coincidir visualmente con la imagen.
   * - Se mantuvo el sistema de modales personalizado.
   * - Se mejoró la frecuencia de polling del frontend para una mejor sincronización del estado.
   * - Se mejoró el manejo del QR para asegurar la visualización correcta.
   * - Se integran los datos reales del usuario de GHL en la sección "Connection Status".
   * - NUEVA CARACTERÍSTICA: Se permite editar el "customName" de la instancia desde el panel.
   */
  private generateCustomPageHTML(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>WLink Bridge - Manager</title>
          <!-- Tailwind CSS CDN para estilos rápidos y responsivos -->
          <script src="https://cdn.tailwindcss.com"></script>
          <!-- Fuentes de Google Fonts (Inter) -->
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
          <!-- React y ReactDOM CDN -->
          <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
          <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
          <!-- Babel para transpilar JSX en el navegador -->
          <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
          <!-- QRCode.js para generar códigos QR -->
          <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
          <!-- Font Awesome para íconos -->
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css"></link>
          <style>
            body {
              font-family: 'Inter', sans-serif;
            }
            /* Estilos para el modal personalizado */
            .modal-overlay {
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background-color: rgba(0, 0, 0, 0.6); /* Fondo más oscuro */
              display: flex;
              justify-content: center;
              align-items: center;
              z-index: 1000;
            }
            .modal-content {
              background-color: white;
              padding: 2rem;
              border-radius: 0.75rem; /* rounded-xl */
              box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2); /* shadow-lg más pronunciado */
              max-width: 90%;
              width: 400px;
              text-align: center;
              animation: fadeIn 0.3s ease-out; /* Animación de entrada */
            }
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(-20px); }
              to { opacity: 1; transform: translateY(0); }
            }
            /* Estilos para el spinner de carga */
            .spinner {
              border: 4px solid rgba(0, 0, 0, 0.1);
              border-left-color: #6366f1; /* Color índigo de Tailwind */
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body class="bg-gray-100 p-4 sm:p-6 min-h-screen flex items-center justify-center">
          <div id="root" class="w-full max-w-3xl mx-auto"></div>
          <script type="text/babel">
            const { useState, useEffect, useRef } = React;

            function App() {
              const [locationId, setLocationId] = useState(null);
              const [encrypted, setEncrypted] = useState(null);
              const [instances, setInstances] = useState([]);
              const [form, setForm] = useState({ instanceId: '', token: '', customName: '' }); // CAMBIO: 'instanceName' a 'customName'
              const [qr, setQr] = useState('');
              const [showQr, setShowQr] = useState(false);
              const [qrLoading, setQrLoading] = useState(false); // Estado para el loading del QR
              const pollRef = useRef(null); // Ref para el intervalo de polling del QR
              const mainIntervalRef = useRef(null); // Ref para el intervalo de polling principal
              const qrInstanceIdRef = useRef(null); // Para guardar el ID de la instancia cuyo QR se está mostrando
              const qrCodeDivRef = useRef(null); // Ref para el div donde se renderizará el QR
              const [modal, setModal] = useState({ show: false, message: '', type: '', onConfirm: null, onCancel: null }); // Estado para el modal
              const [ghlUser, setGhlUser] = useState({ name: 'Loading...', email: 'Loading...', hasTokens: false }); // Estado para los datos del usuario GHL
              const [editingInstanceId, setEditingInstanceId] = useState(null); // Estado para saber qué instancia se está editando
              const [editingCustomName, setEditingCustomName] = useState(''); // CAMBIO: 'editingInstanceName' a 'editingCustomName'

              // Función para mostrar el modal personalizado
              const showModal = (message, type = 'info', onConfirm = null, onCancel = null) => {
                setModal({ show: true, message, type, onConfirm, onCancel });
              };

              // Función para cerrar el modal personalizado
              const closeModal = () => {
                setModal({ show: false, message: '', type: '', onConfirm: null, onCancel: null });
              };

              // Efecto para obtener locationId y encrypted al cargar la página (desde el iframe)
              useEffect(() => {
                const listener = (e) => {
                  if (e.data?.message === 'REQUEST_USER_DATA_RESPONSE') {
                    processUser(e.data.payload);
                  }
                };
                window.addEventListener('message', listener);
                window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*'); // Solicitar datos de usuario al padre
                return () => window.removeEventListener('message', listener);
              }, []);

              // Efecto para cargar instancias y configurar el polling principal una vez que locationId esté disponible
              useEffect(() => {
                if (locationId) {
                  loadInstances();
                  // Configura el polling principal para refrescar el estado de las instancias cada 3 segundos
                  if (mainIntervalRef.current) clearInterval(mainIntervalRef.current); // Limpiar si ya existe
                  mainIntervalRef.current = setInterval(loadInstances, 3000); // Poll every 3 seconds
                }
                // Limpieza de intervalos al desmontar el componente
                return () => {
                  if (mainIntervalRef.current) clearInterval(mainIntervalRef.current);
                  if (pollRef.current) clearInterval(pollRef.current);
                };
              }, [locationId]);

              // Efecto para renderizar el QR cuando 'showQr' y 'qr' cambian
              useEffect(() => {
                console.log('QR useEffect triggered. showQr:', showQr, 'qr data present:', !!qr, 'qrCodeDivRef.current:', qrCodeDivRef.current);
                if (showQr && qr && qrCodeDivRef.current) {
                  qrCodeDivRef.current.innerHTML = ''; // Limpiar cualquier QR anterior
                  // QRCode.js puede tomar una URL de imagen base64 directamente
                  if (qr.startsWith('data:image')) {
                    const img = document.createElement('img');
                    img.src = qr;
                    img.className = "mx-auto max-w-full h-auto"; // Estilos para la imagen QR
                    qrCodeDivRef.current.appendChild(img);
                    console.log('QR rendered as image.');
                  } else {
                    // Si es un string de texto (código de emparejamiento), generarlo como QR
                    try {
                      new QRCode(qrCodeDivRef.current, {
                        text: qr,
                        width: 256,
                        height: 256,
                        colorDark : "#000000",
                        colorLight : "#ffffff",
                        correctLevel : QRCode.CorrectLevel.H
                      });
                      console.log('QR rendered from text data.');
                    } catch (e) {
                      console.error('Error rendering QR from text:', e);
                      qrCodeDivRef.current.innerHTML = '<p class="text-red-500">Error al generar QR.</p>';
                    }
                  }
                } else if (showQr && !qrLoading && !qr) {
                    console.log('QR useEffect: showQr is true, but qr data is missing and not loading.');
                    if (qrCodeDivRef.current) {
                        qrCodeDivRef.current.innerHTML = '<p class="text-red-500">No se pudo cargar el código QR. Intente de nuevo.</p>';
                    }
                }
              }, [showQr, qr, qrLoading]); // Añadido qrLoading a las dependencias

              // Función genérica para hacer solicitudes a la API con manejo de errores y headers
              async function makeApiRequest(path, options = {}) {
                const headers = {
                  'Content-Type': 'application/json',
                  'X-GHL-Context': encrypted, // Asegúrate de enviar el contexto en cada petición
                  ...options.headers,
                };

                const response = await fetch(path, { ...options, headers });
                let data;
                try {
                  data = await response.json();
                } catch (e) {
                  // CORRECCIÓN: Usar concatenación de strings
                  console.error('Error parsing JSON from ' + path + '. Status: ' + response.status + ' ' + response.statusText, e, response);
                  throw new Error(response.statusText || 'Invalid JSON response from server');
                }
                if (!response.ok) {
                  // CORRECCIÓN: Usar concatenación de strings
                  console.error('API request to ' + path + ' failed. Status: ' + response.status + '. Response:', data);
                  throw new Error(data.message || 'API request failed');
                }
                console.log('API request to ' + path + ' successful. Response:', data);
                return data;
              }

              // Procesa los datos de usuario desencriptados del padre
              async function processUser(enc) {
                try {
                  const res = await makeApiRequest('/app/decrypt-user-data', { method: 'POST', body: JSON.stringify({ encryptedData: enc }) });
                  setEncrypted(enc);
                  setLocationId(res.locationId);
                  // Actualizar el estado con los datos reales del usuario de GHL
                  setGhlUser({
                    name: res.userData.fullName || (res.userData.firstName || '') + ' ' + (res.userData.lastName || '') || 'Unknown User',
                    email: res.userData.email || 'N/A',
                    hasTokens: res.user ? res.user.hasTokens : false // Usa el hasTokens del backend
                  });
                  console.log('User data decrypted and locationId set:', res.locationId);
                } catch (err) {
                  console.error('Error processing user data:', err);
                  showModal('Failed to load user data. Please ensure the app is installed correctly. ' + err.message, 'error');
                }
              }

              // Carga y refresca el estado de todas las instancias
              async function loadInstances() {
                try {
                  const data = await makeApiRequest('/api/instances');
                  setInstances(data.instances);
                  console.log('Main polling: Instances loaded:', data.instances);
                  // NUEVO LOG: Mostrar el estado de cada instancia individualmente
                  data.instances.forEach(inst => {
                      console.log('  Instance ' + inst.idInstance + ' (ID: ' + inst.id + ') state: ' + inst.state + ' Custom Name: ' + inst.customName);
                  });

                  // Lógica para cerrar el modal QR desde el polling principal
                  if (showQr && qrInstanceIdRef.current) {
                    const currentInstance = data.instances.find(inst => String(inst.id) === String(qrInstanceIdRef.current));
                    if (currentInstance && currentInstance.state !== 'qr_code' && currentInstance.state !== 'starting') {
                      // CORRECCIÓN: Usar concatenación de strings
                      console.log('Main polling: Closing QR modal as state is now ' + currentInstance.state + '.');
                      clearInterval(pollRef.current);
                      pollRef.current = null;
                      setShowQr(false);
                      setQr('');
                      qrInstanceIdRef.current = null;
                      if (currentInstance.state === 'authorized') {
                        showModal('Instancia conectada exitosamente!', 'success');
                      } else {
                        showModal('La conexión de la instancia cambió de estado. Verifique el panel.', 'info');
                      }
                    } else if (!currentInstance) {
                      console.log('Main polling: Closing QR modal as instance no longer exists.');
                      clearInterval(pollRef.current);
                      pollRef.current = null;
                      setShowQr(false);
                      setQr('');
                      qrInstanceIdRef.current = null;
                      showModal('La instancia ha sido eliminada o no existe.', 'error');
                    }
                  }
                } catch (e) {
                  console.error('Failed to load instances in main polling:', e);
                  // No mostrar modal de error aquí para evitar spam en el polling
                }
              }

              // Crea una nueva instancia
              async function createInstance(e) {
                e.preventDefault();
                try {
                  const payload = { ...form, locationId };
                  await makeApiRequest('/api/instances', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                  });
                  showModal('Instancia creada exitosamente!', 'success');
                  setForm({ instanceId: '', token: '', customName: '' }); // CAMBIO: 'instanceName' a 'customName'
                  loadInstances(); // Recargar instancias después de crear una nueva
                } catch (err) {
                  console.error('Error creating instance:', err);
                  showModal('Error al crear instancia: ' + err.message, 'error');
                }
              }

              // Inicia el polling para el estado de una instancia específica (usado para QR)
              function startPolling(instanceId) {
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                }
                qrInstanceIdRef.current = instanceId;
                
                pollRef.current = setInterval(async () => {
                  try {
                    const data = await makeApiRequest('/api/instances');
                    const updatedInstance = data.instances.find(inst => String(inst.id) === String(instanceId));
                    setInstances(data.instances); // Actualizar la lista de instancias para reflejar el estado más reciente

                    if (updatedInstance) {
                      // CORRECCIÓN: Usar concatenación de strings
                      console.log('QR polling for ' + instanceId + ': Fetched state ' + updatedInstance.state);
                      // Si el estado NO es 'qr_code' Y NO es 'starting', cerramos el modal y el polling.
                      if (updatedInstance.state !== 'qr_code' && updatedInstance.state !== 'starting') {
                        // CORRECCIÓN: Usar concatenación de strings
                        console.log('QR polling: State ' + updatedInstance.state + ' detected, closing QR modal.');
                        clearInterval(pollRef.current);
                        pollRef.current = null;
                        setShowQr(false);
                        setQr('');
                        qrInstanceIdRef.current = null;
                        if (updatedInstance.state === 'authorized') {
                          showModal('Instancia conectada exitosamente!', 'success');
                        } else {
                          showModal('La conexión de la instancia cambió de estado. Verifique el panel.', 'info');
                        }
                      }
                    } else {
                      // CORRECCIÓN: Usar concatenación de strings
                      console.log('QR polling: Instance ' + instanceId + ' not found in fetched data, stopping polling and closing QR.');
                      clearInterval(pollRef.current);
                      pollRef.current = null;
                      setShowQr(false);
                      setQr('');
                      qrInstanceIdRef.current = null;
                      showModal('La instancia ha sido eliminada o no existe.', 'error');
                    }
                  } catch (error) {
                    console.error('Error during QR polling:', error);
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    setShowQr(false);
                    setQr('');
                    qrInstanceIdRef.current = null;
                    showModal('Error al verificar estado del QR. Intente de nuevo.', 'error');
                  }
                }, 2000); // Sondea cada 2 segundos para una respuesta rápida
              }

              // Conecta una instancia (obtiene y muestra el QR)
              async function connectInstance(id) {
                setQrLoading(true); // Iniciar loading
                setQr(''); // Limpiar cualquier QR previo
                setShowQr(true); // Mostrar el contenedor del QR
                qrInstanceIdRef.current = id; // Asignar el ID de la instancia al ref para el QR

                try {
                  // CORRECCIÓN: Usar concatenación de strings
                  console.log('Attempting to fetch QR for instance ID: ' + id);
                  const res = await makeApiRequest('/api/qr/' + id);
                  // CORRECCIÓN: Usar concatenación de strings
                  console.log('QR API response for ' + id + ':', res);
                  console.log('QR response type: ' + res.type + ', data starts with: ' + (res.data ? res.data.substring(0, 50) : 'N/A'));


                  if (res.type === 'qr') {
                    // Asegurar que la data del QR tenga el prefijo data:image/png;base64,
                    const finalQrData = res.data.startsWith('data:image') ? res.data : 'data:image/png;base64,' + res.data;
                    setQr(finalQrData);
                    console.log('QR type received. Setting QR data. Starts with data:image: ' + finalQrData.startsWith('data:image'));
                  } else if (res.type === 'code') {
                    // Si Evolution API devuelve un pairing code, lo convertimos a QR
                    console.log('Code type received. Generating QR from text: ' + res.data);
                    const qrImage = await generateQrFromString(res.data);
                    setQr(qrImage);
                  } else {
                    throw new Error('Unexpected QR response format. Type was: ' + res.type);
                  }
                  setQrLoading(false); // Detener loading

                  // Iniciar el sondeo para el estado de la instancia inmediatamente después de obtener el QR
                  startPolling(id);

                } catch (err) {
                  setQrLoading(false); // Detener loading en caso de error
                  console.error('Error obtaining QR:', err);
                  setQr('');
                  setShowQr(false); // Asegurarse de que el modal se cierre si la petición de QR falla.
                  qrInstanceIdRef.current = null;
                  showModal('Error obteniendo QR: ' + err.message, 'error');
                  if (pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                  }
                }
              }

              // Genera una imagen QR a partir de una cadena de texto (para pairing codes)
              async function generateQrFromString(text) {
                return new Promise((resolve, reject) => {
                  if (!window.QRCode) {
                    console.error('QRCode library not loaded!');
                    return reject(new Error('QRCode library not loaded'));
                  }
                  const container = document.createElement('div');
                  new window.QRCode(container, {
                    text,
                    width: 256,
                    height: 256,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                  });
                  // Pequeño retraso para asegurar que el QR se renderiza en el canvas/img antes de capturar
                  setTimeout(() => {
                    const img = container.querySelector('img') || container.querySelector('canvas');
                    if (img) {
                      const dataUrl = img.src || img.toDataURL('image/png');
                      console.log('Generated QR from string successfully.');
                      resolve(dataUrl);
                    } else {
                      console.error('Failed to find QR image in container after generation.');
                      reject(new Error('Failed to generate QR image'));
                    }
                  }, 100);
                });
              }

              // Desconecta una instancia (logout)
              async function logoutInstance(id) {
                showModal(
                  '¿Estás seguro de que quieres desconectar esta instancia? Esto cerrará la sesión de WhatsApp y requerirá un nuevo escaneo de QR para reconectar.',
                  'confirm',
                  async () => { // onConfirm callback
                    closeModal(); // Cerrar el modal de confirmación
                    try {
                      // CORRECCIÓN: Usar concatenación de strings
                      console.log('Attempting to logout instance ID: ' + id);
                      await makeApiRequest('/api/instances/' + id + '/logout', { method: 'DELETE' });
                      // CORRECCIÓN: Usar concatenación de strings
                      console.log('Instance ' + id + ' logout command sent successfully. Reloading instances...');
                      showModal('Comando de desconexión de instancia enviado. El estado se actualizará en breve y requerirá un nuevo escaneo.', 'success');
                      loadInstances(); // Recargar instancias para reflejar el cambio de estado
                    } catch (err) {
                      console.error('Error disconnecting instance:', err);
                      showModal('Error al desconectar: ' + err.message, 'error');
                    }
                  },
                  () => closeModal() // onCancel callback
                );
              }

              // Elimina una instancia permanentemente
              async function deleteInstance(id) {
                showModal(
                  '¿Estás seguro de que quieres ELIMINAR esta instancia? Esta acción es permanente y borrará la instancia de Evolution API y de la base de datos.',
                  'confirm',
                  async () => { // onConfirm callback
                    closeModal();
                    try {
                      // CORRECCIÓN: Usar concatenación de strings
                      console.log('Attempting to delete instance ID: ' + id);
                      await makeApiRequest('/api/instances/' + id, { method: 'DELETE' });
                      // CORRECCIÓN: Usar concatenación de strings
                      console.log('Instance ' + id + ' delete command sent. Reloading instances...');
                      showModal('Instancia eliminada exitosamente!', 'success');
                      loadInstances(); // Recargar instancias después de eliminar
                    } catch (err) {
                      console.error('Error deleting instance:', err);
                      showModal('Error al eliminar instancia: ' + err.message, 'error');
                    }
                  },
                  () => closeModal() // onCancel callback
                );
              }

              // Función para iniciar la edición del nombre personalizado de una instancia
              const startEditingName = (instanceId, currentCustomName) => { // CAMBIO: 'currentName' a 'currentCustomName'
                setEditingInstanceId(instanceId);
                setEditingCustomName(currentCustomName); // CAMBIO: 'setEditingInstanceName' a 'setEditingCustomName'
              };

              // Función para guardar el nombre personalizado editado de una instancia
              const saveEditedName = async (instanceId) => {
                try {
                  await makeApiRequest('/api/instances/' + instanceId, {
                    method: 'PATCH',
                    body: JSON.stringify({ customName: editingCustomName }), // CAMBIO: 'name' a 'customName'
                  });
                  showModal('Nombre de instancia actualizado exitosamente!', 'success');
                  setEditingInstanceId(null); // Salir del modo de edición
                  setEditingCustomName('');
                  loadInstances(); // Recargar instancias para reflejar el cambio
                } catch (err) {
                  console.error('Error al actualizar el nombre de la instancia:', err);
                  showModal('Error al actualizar el nombre: ' + err.message, 'error');
                }
              };

              // Función para cancelar la edición del nombre personalizado de una instancia
              const cancelEditingName = () => {
                setEditingInstanceId(null);
                setEditingCustomName('');
              };

              // Placeholder para la función Open Console
              const openConsole = (instanceId) => {
                showModal('Abriendo consola para la instancia: ' + instanceId, 'info');
                // Aquí iría la lógica real para abrir la consola de la instancia,
                // por ejemplo, redirigir a una URL específica de Evolution API.
                // window.open('https://your-evolution-api-console-url/' + instanceId, '_blank');
              };


              return (
                <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 space-y-6 border border-gray-200 w-full">
                  {/* Encabezado con logo y título */}
                  <div className="flex flex-col items-center justify-center mb-6">
                    <img src="https://placehold.co/60x60/00FF00/FFFFFF?text=G" alt="Logo" className="h-16 w-16 mb-2" />
                    <h1 className="text-3xl font-bold text-center text-gray-800">WhatsApp Integration</h1>
                    <p className="text-gray-500 text-center">Manage your GREEN-API instances with ease</p>
                  </div>

                  {/* Sección de Connection Status */}
                  <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 shadow-sm">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center">
                      <i className="fas fa-signal text-blue-500 mr-2"></i> Connection Status
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-700">
                      <div>
                        <p><i className="fas fa-user text-gray-400 mr-2"></i> <strong>User:</strong> {ghlUser.name}</p>
                        <p><i className="fas fa-envelope text-gray-400 mr-2"></i> <strong>Email:</strong> {ghlUser.email}</p>
                        <p><i className="fas fa-map-marker-alt text-gray-400 mr-2"></i> <strong>Location ID:</strong> {locationId || 'Loading...'}</p>
                      </div>
                      <div>
                        <p><i className="fas fa-shield-alt text-green-500 mr-2"></i> <strong>OAuth Status:</strong></p>
                        <p className="ml-6">
                          {ghlUser.hasTokens ? (
                            <><i className="fas fa-check-circle text-green-500 mr-2"></i> Authenticated and ready</>
                          ) : (
                            <><i className="fas fa-exclamation-triangle text-yellow-500 mr-2"></i> Not Authenticated</>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Sección de Your WhatsApp Instances */}
                  <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 shadow-sm">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center">
                      <i className="fab fa-whatsapp text-green-500 mr-2"></i> Your WhatsApp Instances
                    </h2>
                    <div className="space-y-4">
                      {instances.length === 0 && <p className="text-gray-500 text-center py-4">No instances added yet. Add one above!</p>}
                      
                      {instances.map((inst) => (
                        <div key={inst.id} className="flex flex-col sm:flex-row justify-between items-center p-4 border border-gray-200 rounded-xl bg-white shadow-sm">
                          <div className="text-center sm:text-left mb-3 sm:mb-0">
                            {/* Mostrar idInstance como el ID único */}
                            <p className="text-sm text-gray-500">Instance ID: {inst.idInstance || inst.guid || 'N/A'}</p>
                            {/* Campo de nombre personalizado editable */}
                            {editingInstanceId === inst.id ? (
                              <div className="flex flex-col items-center sm:items-start">
                                <input
                                  type="text"
                                  value={editingCustomName} // CAMBIO: Usar editingCustomName
                                  onChange={(e) => setEditingCustomName(e.target.value)} // CAMBIO: setEditingCustomName
                                  className="font-semibold text-lg text-gray-800 border-b border-gray-300 focus:outline-none focus:border-indigo-500 mb-1"
                                />
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={() => saveEditedName(inst.id)}
                                    className="px-2 py-1 rounded-md bg-indigo-500 text-white text-sm"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={cancelEditingName}
                                    className="px-2 py-1 rounded-md bg-gray-300 text-gray-800 text-sm"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center sm:items-start">
                                <p className="font-semibold text-lg text-gray-800">
                                  {inst.customName || 'Unnamed Instance'} {/* CAMBIO: Mostrar customName */}
                                  <button
                                    onClick={() => startEditingName(inst.id, inst.customName || '')} // CAMBIO: Pasar customName
                                    className="ml-2 text-blue-500 hover:text-blue-700 text-sm"
                                    title="Edit Instance Name"
                                  >
                                    <i className="fas fa-pencil-alt"></i>
                                  </button>
                                </p>
                              </div>
                            )}
                            <p className="text-sm text-gray-500">Created: {new Date(inst.createdAt).toLocaleDateString()}</p> {/* Usar inst.createdAt */}
                            <span
                              className={
                                "mt-2 inline-block text-xs px-3 py-1 rounded-full font-medium " +
                                (inst.state === 'authorized'
                                  ? 'bg-green-100 text-green-800' // Conectado y autorizado
                                  : inst.state === 'qr_code' || inst.state === 'starting'
                                  ? 'bg-yellow-100 text-yellow-800' // Esperando acción (QR) o iniciando
                                  : inst.state === 'notAuthorized'
                                  ? 'bg-red-100 text-red-800' // Desconectado (rojo para mayor visibilidad)
                                  : inst.state === 'yellowCard' || inst.state === 'blocked'
                                  ? 'bg-red-500 text-white' // Estados de error o bloqueado (más oscuro)
                                  : 'bg-gray-200 text-gray-800') // Para cualquier otro estado no mapeado
                              }
                            >
                              {
                                // Muestra "Awaiting Scan" si el modal de QR está abierto para esta instancia
                                showQr && String(qrInstanceIdRef.current) === String(inst.id)
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
                          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto mt-4 sm:mt-0">
                            <button
                              onClick={() => openConsole(inst.id)}
                              className="w-full sm:w-auto px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-150 ease-in-out"
                            >
                              Open Console
                            </button>
                            {inst.state === 'authorized' ? ( // Solo 'authorized' debe poder desconectarse (hacer logout)
                              <button
                                onClick={() => logoutInstance(inst.id)}
                                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-yellow-500 text-white font-semibold shadow-md hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 transition duration-150 ease-in-out"
                              >
                                Logout
                              </button>
                            ) : (
                              <button
                                onClick={() => connectInstance(inst.id)}
                                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-green-600 text-white font-semibold shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition duration-150 ease-in-out"
                              >
                                Connect
                              </button>
                            )}
                            <button
                              onClick={() => deleteInstance(inst.id)}
                              className="w-full sm:w-auto px-4 py-2 rounded-lg bg-red-600 text-white font-semibold shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition duration-150 ease-in-out"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sección de Add New Instance */}
                  <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 shadow-sm">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center">
                      <i className="fas fa-plus-circle text-green-500 mr-2"></i> Add New Instance
                    </h2>
                    <form onSubmit={createInstance} className="space-y-4">
                      <div>
                        <label htmlFor="instanceId" className="block text-sm font-medium text-gray-700">Instance ID</label>
                        <input
                          type="text"
                          id="instanceId"
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                          value={form.instanceId}
                          onChange={(e) => setForm({ ...form, instanceId: e.target.value })}
                          placeholder="e.g., 1234567890"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="token" className="block text-sm font-medium text-gray-700">API Token</label>
                        <input
                          type="text"
                          id="token"
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                          value={form.token}
                          onChange={(e) => setForm({ ...form, token: e.target.value })}
                          placeholder="Your GREEN-API token"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="customName" className="block text-sm font-medium text-gray-700">Instance Name (optional)</label> {/* CAMBIO: htmlFor y label */}
                        <input
                          type="text"
                          id="customName" {/* CAMBIO: id */}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                          value={form.customName} // CAMBIO: form.instanceName a form.customName
                          onChange={(e) => setForm({ ...form, customName: e.target.value })} // CAMBIO: instanceName a customName
                          placeholder="e.g., Sales Team WhatsApp"
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition duration-150 ease-in-out"
                      >
                        Add Instance
                      </button>
                    </form>
                  </div>

                  {/* Modal de QR Code */}
                  {showQr && (
                    <div className="modal-overlay" onClick={() => {
                      console.log('QR Overlay clicked: Closing QR modal.');
                      setShowQr(false);
                      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                      setQr('');
                      qrInstanceIdRef.current = null;
                    }}>
                      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-2xl font-bold text-gray-800 mb-4">Scan QR Code</h2>
                        {qrLoading ? (
                          <div className="flex flex-col items-center justify-center h-48">
                            <div className="spinner"></div>
                            <p className="mt-4 text-gray-600 text-lg">Loading QR...</p>
                          </div>
                        ) : qr ? (
                          <div className="flex justify-center items-center h-64 w-64 mx-auto p-2 border border-gray-300 rounded-md bg-white">
                            <div ref={qrCodeDivRef} className="w-full h-full flex items-center justify-center"></div>
                          </div>
                        ) : (
                          <p className="text-red-500 text-lg">No se pudo cargar el código QR. Intente de nuevo.</p>
                        )}
                        <button
                          onClick={() => {
                            console.log('QR Close button clicked: Closing QR modal.');
                            setShowQr(false);
                            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                            setQr('');
                            qrInstanceIdRef.current = null;
                          }}
                          className="mt-6 px-6 py-2 rounded-lg bg-gray-700 text-white font-semibold shadow-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition duration-150 ease-in-out"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Modal de Alerta/Confirmación General */}
                  {modal.show && (
                    <div className="modal-overlay">
                      <div className="modal-content">
                        <p className="text-lg font-medium mb-6 text-gray-700">{modal.message}</p>
                        <div className="flex justify-center gap-4">
                          {modal.type === 'confirm' && (
                            <button
                              onClick={modal.onCancel}
                              className="px-6 py-2 rounded-lg bg-gray-300 text-gray-800 font-semibold hover:bg-gray-400 transition duration-150 ease-in-out"
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            onClick={modal.onConfirm || closeModal} // Si es confirm, usa onConfirm, sino closeModal
                            className={"px-6 py-2 rounded-lg text-white font-semibold shadow-md transition duration-150 ease-in-out " + (
                              modal.type === 'error' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
                            )}
                          >
                            {modal.type === 'confirm' ? 'Confirm' : 'OK'}
                          </button>
                        </div>
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


