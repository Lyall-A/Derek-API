# Derek API
A backend to control Derek

## API
- **GET** `/job` - Get current job
- **POST** `/job` - Set job
- **POST** `/command` - Send command (G-code) to Derek
- **GET** `/psus` - Array of all PSU status
- **GET** `/lights` - Array of all light status
- **GET** `/cameras` - Array of all camera status
- **GET** `/psu/{index}` - Get PSU status
- **POST** `/psu/{index}` - Set PSU status
- **GET** `/light/{index}` - Get Light status
- **POST** `/light/{index}` - Set Light status
- **GET** `/camera/{index}` - Get Camera status
- **POST** `/camera/{index}` - Set Camera status
- **GET** `/camera/{index}/stream` - MJPEG stream of camera
- **GET** `/camera/{index}/still` - Snapshot of camera