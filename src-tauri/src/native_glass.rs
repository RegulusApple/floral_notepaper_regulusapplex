//! Native desktop blur, clipped in composition to the same 16-DIP outline as CSS.
//! Never capture wallpaper/screenshots or lower whole-window opacity: the WebView
//! owns the independent tint and sharp text above the compositor's blurred backdrop.
use crate::services::notes::AppError;

pub fn is_surface(label: &str) -> bool {
    label.starts_with("tile-") || label.starts_with("notepad-") || label == "todo"
}

pub fn release(label: &str) {
    #[cfg(target_os = "windows")]
    composition::release(label);
    #[cfg(not(target_os = "windows"))]
    let _ = label;
}

#[cfg(target_os = "windows")]
pub fn clip(window: &tauri::Window) -> Result<(), AppError> {
    composition::resize(window);
    Ok(())
}

pub fn apply(window: &tauri::WebviewWindow, enabled: bool, dark: bool) -> Result<String, AppError> {
    if !is_surface(window.label()) {
        return Ok("none".into());
    }
    #[cfg(target_os = "windows")]
    {
        if cfg!(debug_assertions) && std::env::var("FLORAL_GLASS_PLAIN").is_ok() {
            clip(&window.as_ref().window())?;
            return Ok("transparent".into());
        }
        let _ = dark; // The independently adjustable WebView tint owns theme color.
        if enabled {
            match composition::attach(window) {
                Ok(()) => Ok("gaussian-blur".into()),
                Err(error) => {
                    eprintln!("native glass: {error}");
                    Ok("transparent".into())
                }
            }
        } else {
            release(window.label());
            Ok("transparent".into())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (enabled, dark);
        Ok("transparent".into())
    }
}

#[cfg(target_os = "windows")]
mod composition {
    use std::{cell::RefCell, collections::HashMap};
    use windows::{
        core::Interface,
        System::{DispatcherQueue, DispatcherQueueController},
        Win32::{
            Foundation::HWND,
            System::WinRT::{
                Composition::ICompositorDesktopInterop, CreateDispatcherQueueController,
                DispatcherQueueOptions, DQTAT_COM_STA, DQTYPE_THREAD_CURRENT,
            },
        },
        UI::Composition::{
            CompositionRoundedRectangleGeometry, Compositor, Desktop::DesktopWindowTarget,
        },
    };
    use windows::{
        core::{implement, GUID, HSTRING, PCWSTR},
        Foundation::{IPropertyValue, PropertyValue},
        Graphics::Effects::{
            IGraphicsEffect, IGraphicsEffectSource, IGraphicsEffectSource_Impl,
            IGraphicsEffect_Impl,
        },
        Win32::System::WinRT::Graphics::Direct2D::{
            IGraphicsEffectD2D1Interop, IGraphicsEffectD2D1Interop_Impl,
            GRAPHICS_EFFECT_PROPERTY_MAPPING,
        },
    };
    use windows_numerics::Vector2;
    #[implement(IGraphicsEffect, IGraphicsEffectSource, IGraphicsEffectD2D1Interop)]
    struct DesktopBlur {
        source: IGraphicsEffectSource,
    }
    impl IGraphicsEffectSource_Impl for DesktopBlur_Impl {}
    impl IGraphicsEffect_Impl for DesktopBlur_Impl {
        fn Name(&self) -> windows::core::Result<HSTRING> {
            Ok("DesktopBlur".into())
        }
        fn SetName(&self, _: &HSTRING) -> windows::core::Result<()> {
            Ok(())
        }
    }
    impl IGraphicsEffectD2D1Interop_Impl for DesktopBlur_Impl {
        fn GetEffectId(&self) -> windows::core::Result<GUID> {
            Ok(GUID::from_u128(0x1feb6d69_2fe6_4ac9_8c58_1d7f93e7a6a5))
        }
        fn GetNamedPropertyMapping(
            &self,
            _: &PCWSTR,
            _: *mut u32,
            _: *mut GRAPHICS_EFFECT_PROPERTY_MAPPING,
        ) -> windows::core::Result<()> {
            Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                0x80070057u32 as i32,
            )))
        }
        fn GetPropertyCount(&self) -> windows::core::Result<u32> {
            Ok(3)
        }
        fn GetProperty(&self, index: u32) -> windows::core::Result<IPropertyValue> {
            match index {
                0 => PropertyValue::CreateSingle(18.0)?.cast(),
                1 | 2 => PropertyValue::CreateUInt32(1)?.cast(),
                _ => Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80070057u32 as i32,
                ))),
            }
        }
        fn GetSource(&self, index: u32) -> windows::core::Result<IGraphicsEffectSource> {
            if index == 0 {
                Ok(self.source.clone())
            } else {
                Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80070057u32 as i32,
                )))
            }
        }
        fn GetSourceCount(&self) -> windows::core::Result<u32> {
            Ok(1)
        }
    }
    struct Context {
        _queue: Option<DispatcherQueueController>,
        compositor: Compositor,
        targets: HashMap<String, (DesktopWindowTarget, CompositionRoundedRectangleGeometry)>,
    }
    thread_local! { static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) }; }
    pub fn attach(window: &tauri::WebviewWindow) -> windows::core::Result<()> {
        CONTEXT.with(|cell| {
            let mut context = cell.try_borrow_mut().map_err(|_| {
                windows::core::Error::from_hresult(windows::core::HRESULT(0x8000000eu32 as i32))
            })?;
            if context.is_none() {
                let queue = if DispatcherQueue::GetForCurrentThread().is_err() {
                    Some(unsafe {
                        CreateDispatcherQueueController(DispatcherQueueOptions {
                            dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
                            threadType: DQTYPE_THREAD_CURRENT,
                            apartmentType: DQTAT_COM_STA,
                        })?
                    })
                } else {
                    None
                };
                *context = Some(Context {
                    _queue: queue,
                    compositor: Compositor::new()?,
                    targets: HashMap::new(),
                });
            }
            let context = context.as_mut().unwrap();
            if context.targets.contains_key(window.label()) {
                return Ok(());
            }
            let hwnd = HWND(
                window
                    .hwnd()
                    .map_err(|_| windows::core::Error::from_win32())?
                    .0,
            );
            unsafe {
                let enabled: i32 = 1;
                use windows_sys::Win32::Graphics::Dwm::*;
                let blur = DWM_BLURBEHIND {
                    dwFlags: DWM_BB_ENABLE,
                    fEnable: 1,
                    hRgnBlur: std::ptr::null_mut(),
                    fTransitionOnMaximized: 0,
                };
                // Preserve the transparent HWND's alpha. This API does not itself
                // provide blur on current Windows; the effect graph below does.
                windows::core::HRESULT(DwmEnableBlurBehindWindow(hwnd.0, &blur)).ok()?;
                let result = windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute(
                    hwnd.0,
                    windows_sys::Win32::Graphics::Dwm::DWMWA_USE_HOSTBACKDROPBRUSH as _,
                    &enabled as *const _ as _,
                    4,
                );
                windows::core::HRESULT(result).ok()?;
            }
            let interop: ICompositorDesktopInterop = context.compositor.cast()?;
            // Below the WebView child HWND, so text/controls are never blurred.
            let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? };
            let visual = context.compositor.CreateSpriteVisual()?;
            visual.SetRelativeSizeAdjustment(Vector2 { X: 1.0, Y: 1.0 })?;
            let source_name = HSTRING::from("Backdrop");
            let source =
                windows::UI::Composition::CompositionEffectSourceParameter::Create(&source_name)?;
            let effect: IGraphicsEffect = DesktopBlur {
                source: source.cast()?,
            }
            .into();
            let brush = context
                .compositor
                .CreateEffectFactory(&effect)?
                .CreateBrush()?;
            // CreateHostBackdropBrush produced a black surface on Win11 26200.
            // Backdrop + GaussianBlur is verified against live windows, not a
            // wallpaper image embedded in the glass surface.
            brush.SetSourceParameter(&source_name, &context.compositor.CreateBackdropBrush()?)?;
            visual.SetBrush(&brush)?;
            let geometry = context.compositor.CreateRoundedRectangleGeometry()?;
            let size = window
                .inner_size()
                .map_err(|_| windows::core::Error::from_win32())?;
            let radius = (16.0 * window.scale_factor().unwrap_or(1.0)) as f32;
            geometry.SetSize(Vector2 {
                X: size.width as f32,
                Y: size.height as f32,
            })?;
            geometry.SetCornerRadius(Vector2 {
                X: radius,
                Y: radius,
            })?;
            visual.SetClip(
                &context
                    .compositor
                    .CreateGeometricClipWithGeometry(&geometry)?,
            )?;
            target.SetRoot(&visual)?;
            context
                .targets
                .insert(window.label().to_string(), (target, geometry));
            Ok(())
        })
    }
    pub fn resize(window: &tauri::Window) {
        CONTEXT.with(|cell| {
            let Ok(borrowed) = cell.try_borrow() else {
                return;
            };
            if let Some(context) = borrowed.as_ref() {
                if let Some((_, geometry)) = context.targets.get(window.label()) {
                    if let Ok(size) = window.inner_size() {
                        let _ = geometry.SetSize(Vector2 {
                            X: size.width as f32,
                            Y: size.height as f32,
                        });
                        let radius = (16.0 * window.scale_factor().unwrap_or(1.0)) as f32;
                        let _ = geometry.SetCornerRadius(Vector2 {
                            X: radius,
                            Y: radius,
                        });
                    }
                }
            }
        });
    }
    pub fn release(label: &str) {
        CONTEXT.with(|cell| {
            // Close outside the RefCell borrow: native callbacks can re-enter.
            let target = cell
                .borrow_mut()
                .as_mut()
                .and_then(|context| context.targets.remove(label));
            if let Some((target, _)) = target {
                let _ = target.Close();
            }
        });
    }
}
