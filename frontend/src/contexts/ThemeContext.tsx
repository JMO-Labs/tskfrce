import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useClientValue } from '../v2/hooks/useClientValue';
import { 
  getThemePreference, 
  saveThemePreference, 
  getUserSettings, 
  saveUserSettings 
} from '../utils/cookies';
import { BrandColors, defaultBrandColors, createMantineTheme } from '../lib/mantine-theme';

/**
 * @description Theme context interface
 */
interface ThemeContextType {
  /** Whether dark mode is enabled */
  isDarkMode: boolean;
  /** Current theme preference */
  theme: 'light' | 'dark' | 'system';
  /** Current brand colors */
  brandColors: BrandColors;
  /** Current Mantine theme object */
  mantineTheme: any;
  /** Function to toggle dark mode */
  toggleDarkMode: () => void;
  /** Function to set dark mode explicitly */
  setDarkMode: (enabled: boolean) => void;
  /** Function to set theme preference */
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  /** Function to update brand colors */
  setBrandColors: (colors: Partial<BrandColors>) => void;
  /** Function to reset brand colors to default */
  resetBrandColors: () => void;
}

/**
 * @description Theme context default values
 */
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * @description Get system theme preference
 */
const getSystemTheme = (): boolean => {
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
};

type ThemePref = 'light' | 'dark' | 'system';

const subscribeSystemTheme = (cb: () => void) => {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

// getSnapshot must be referentially stable, so the saved colors are cached per cookie value
let brandCache: { key: string; colors: BrandColors } | undefined;
const getSavedBrandColors = (): BrandColors => {
  const saved = getUserSettings()?.brandColors;
  const key = JSON.stringify(saved ?? null);
  if (brandCache?.key !== key) brandCache = { key, colors: saved ?? defaultBrandColors };
  return brandCache.colors;
};

/**
 * @description Theme provider component
 * Manages dark mode state and persists user preference
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Cookie-backed values read on the client only (server and hydration render the defaults); edits override them.
  const savedTheme = useClientValue<ThemePref>(getThemePreference, 'system');
  const savedBrand = useClientValue(getSavedBrandColors, defaultBrandColors);
  const [themeEdit, setThemeEdit] = useState<ThemePref | null>(null);
  const [brandEdit, setBrandEdit] = useState<BrandColors | null>(null);
  const isInitialized = useClientValue(() => true, false);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemTheme, () => false);
  const theme = themeEdit ?? savedTheme;
  const brandColors = brandEdit ?? savedBrand;
  const isDarkMode = theme === 'dark' || (theme === 'system' && systemDark);
  const mantineTheme = useMemo(() => createMantineTheme(brandColors), [brandColors]);

  /**
   * @description Apply theme to document
   */
  useEffect(() => {
    if (!isInitialized) return;

    const root = document.documentElement;
    
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    

  }, [isDarkMode, isInitialized]);

  /**
   * @description Set theme preference
   */
  const setTheme = (newTheme: ThemePref) => {
    setThemeEdit(newTheme);
    saveThemePreference(newTheme);
  };

  /**
   * @description Toggle dark mode (legacy function)
   */
  const toggleDarkMode = () => {
    const newTheme = isDarkMode ? 'light' : 'dark';
    setTheme(newTheme);
  };

  /**
   * @description Set dark mode explicitly (legacy function)
   */
  const setDarkMode = (enabled: boolean) => {
    const newTheme = enabled ? 'dark' : 'light';
    setTheme(newTheme);
  };

  /**
   * @description Update brand colors
   */
  const setBrandColors = (colors: Partial<BrandColors>) => {
    const newBrandColors = { ...brandColors, ...colors };
    setBrandEdit(newBrandColors);

    // Save to user settings
    try {
      const currentSettings = getUserSettings() || {};
      saveUserSettings({
        ...currentSettings,
        brandColors: newBrandColors
      });
    } catch (error) {
      console.error('Failed to save brand colors:', error);
    }
  };

  /**
   * @description Reset brand colors to default
   */
  const resetBrandColors = () => {
    setBrandEdit(defaultBrandColors);
    
    // Remove from user settings
    try {
      const currentSettings = getUserSettings() || {};
      const { brandColors: _, ...settingsWithoutBrandColors } = currentSettings;
      saveUserSettings(settingsWithoutBrandColors);
    } catch (error) {
      console.error('Failed to reset brand colors:', error);
    }
  };

  return (
    <ThemeContext.Provider value={{ 
      isDarkMode, 
      theme,
      brandColors,
      mantineTheme,
      toggleDarkMode, 
      setDarkMode, 
      setTheme,
      setBrandColors,
      resetBrandColors
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * @description Hook to use theme context
 */
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
