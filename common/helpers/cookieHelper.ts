export const cookieHelper = () => {

    // Function to set a cookie with an optional expiration
    const set = (name: string, value: string, maxAge?: number) => {
        let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
        if (maxAge) {
            cookieString += `; max-age=${maxAge}`;
        } else {
             cookieString += `; max-age=31536000`; // Default to 1 year
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
