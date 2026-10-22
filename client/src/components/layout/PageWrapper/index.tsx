import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastContainer } from "react-toastify";

import NavigationBar from "@/components/layout/NavigationBar";
import Footer from "@/components/layout/Footer";

import PageWrapperProps from "./PageWrapperProps";
import * as styles from "./PageWrapper.module.css";

const queryClient = new QueryClient();

function PageWrapper({
    children,
    className,
    style,
    contentClassName,
    contentStyle,
    footerClassName,
    footerStyle
}: PageWrapperProps) {
    return <QueryClientProvider client={queryClient}>
        <div className={className} style={style}>
            <NavigationBar/>

            <div
                className={`${styles.content} ${contentClassName}`}
                style={contentStyle}
            >
                {children}
            </div>

            <Footer className={footerClassName} style={footerStyle} />

            <ToastContainer/>
        </div>
    </QueryClientProvider>;
}

export default PageWrapper;
