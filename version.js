// version.js

export async function getVersion() {
  try {
    const response = await fetch('/package.json');
    const data = await response.json();
    return data.version;
  } catch (error) {
    console.error('Error cargando versión:', error);
    return '0.0.0';
  }
}