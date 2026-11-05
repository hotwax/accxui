export const cookieDomain = (hostname: string, isDevelopment: boolean) =>
    !isDevelopment && (hostname === "hotwax.io" || hostname.endsWith(".hotwax.io"))
        ? "; domain=hotwax.io" : "";

export const cookieHelper = () => {

    // Function to set a cookie with an optional expiration
    const set = (name: string, value: string, maxAge?: number) => {
        // Shared HotWax sessions stay on HotWax hosts; previews need host-only cookies.
        const domain = cookieDomain(window.location.hostname, import.meta.env.DEV);
        let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; SameSite=Lax${domain}`;
        if (maxAge) {
            cookieString += `; max-age=${maxAge}`;
        } else {
            cookieString += `; max-age=86400`; // Default to 1 day
        }
        document.cookie = cookieString;
    };

    // Function to get a cookie value by name
    const get = (name: string): string | null => {
        const cookies = document.cookie.split('; ');
        for (const cookie of cookies) {
            const [key, value] = cookie.split('=');
            if (decodeURIComponent(key) === name) {
                return decodeURIComponent(value);
            }
        }
        return null;
    };

    // Function to remove a cookie
    const remove = (name: string) => {
        document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
    };

    return {
        set,
        get,
        remove,
    };
};
