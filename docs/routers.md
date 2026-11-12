# Router compatibility

The home box pauses a device by stepping in between it and your router. Some routers stop it from doing that. When you press "Test block" on a device and the result says the device stayed online and never talked to the box, your router is probably the reason. Check the list below for your router, and if yours isn't listed, please tell us so we can add it.

| Router | Works? | Notes |
|---|---|---|
| Most ISP routers | Works | — |
| Eero (mesh) | Often resists | Try disabling 'Client steering' / use a wired box. |
| Google Wifi / Nest Wifi | Often resists | — |
| UniFi with "Client device isolation" | Resists until isolation is off | Turn off "Client device isolation" for the network the box is on. |
| UniFi with "Proxy ARP" | Resists until it is off | Turn off Proxy ARP for the network. |
| Asus AiMesh | Usually works | — |

## Access points: Proxy ARP and client isolation

On UniFi, **Proxy ARP** and **client isolation** (also called guest or L2 isolation) can stop the box seeing and intercepting Wi-Fi devices. Symptom: Test block says it never saw the device use the internet, or a blocked phone still gets online. Turn both off for the home network.

## Report your router

If you tried "Test block" and your router isn't on this list, or it's listed but doesn't match what you see, [open a router report](https://github.com/JMO-Labs/tskfrce/issues/new?labels=router). Include your router's make and model, and what "Test block" said.
